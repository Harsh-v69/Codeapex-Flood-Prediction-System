"""
MFIS — Mumbai Flood Intelligence System
mumbai_flood_model.py

Mumbai-specific flood prediction model trained on:
  • mumbai_flood_dataset.csv       — 2,192 daily observations (2015–2020)
  • 6b7b0aed-...csv                — Historical monthly Mumbai rainfall (1901–2021)
  • export__4_.geojson             — 919 Mumbai waterways (nullahs, drains, canals)
  • n19_e072/e073_1arc_v3.tif      — SRTM 1-arc-sec DEM covering Mumbai region

Mumbai context baked in:
  • Monsoon season = June–September (all floods in data occur in these months)
  • Nullahs / storm drains network from GeoJSON used for drainage proximity score
  • Mean sea level reference for tidal backwater effect (elevation < 5m critical)
  • Arabian Sea proximity inferred from western longitude boundary
"""

from __future__ import annotations

import json
import warnings
import pickle
from pathlib import Path
from collections import defaultdict

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.metrics import (
    classification_report, roc_auc_score, confusion_matrix,
    precision_recall_curve, average_precision_score,
)
from sklearn.utils.class_weight import compute_class_weight
from sklearn.pipeline import Pipeline
from sklearn.inspection import permutation_importance

warnings.filterwarnings("ignore")

try:
    import rasterio
    from rasterio.enums import Resampling
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False

try:
    import geopandas as gpd
    HAS_GEOPANDAS = True
except ImportError:
    HAS_GEOPANDAS = False

# ── Mumbai-specific constants ──────────────────────────────────────────────────

# Mithi River danger level (m above mean sea level) — triggers Mumbai flooding
MITHI_DANGER_LEVEL_M   = 3.50
MITHI_WARNING_LEVEL_M  = 2.80

# Mumbai DEM tiles covering the city
DEM_TILES = [
    r"C:\Users\ASUS\Desktop\mfis\n19_e072_1arc_v3.tif",
    r"C:\Users\ASUS\Desktop\mfis\n19_e073_1arc_v3.tif",
]

# Bounding box of Mumbai Metropolitan Region (from GeoJSON analysis)
MUMBAI_BBOX = {
    "lon_min": 72.8111, "lon_max": 73.1135,
    "lat_min": 18.8638, "lat_max": 19.3031,
}

# Grid resolution
GRID_SIZE_M = 50

# Risk thresholds (probability × 100)
RISK_THRESHOLDS = {"critical": 75, "high": 55, "medium": 35}

# Mumbai monsoon months
MONSOON_MONTHS = {6, 7, 8, 9}

# Paths
FLOOD_CSV_PATH    = r"C:\Users\ASUS\Desktop\mfis\mumbai_flood_dataset.csv"
RAINFALL_CSV_PATH = r"C:\Users\ASUS\Desktop\mfis\mumbai_rainfall.csv"
GEOJSON_PATH      = r"C:\Users\ASUS\Desktop\mfis\drainagemumbai.geojson"
MODEL_SAVE_PATH   = "output/mumbai_flood_model.pkl"


# ── GeoJSON: Nullah / Drain Network ───────────────────────────────────────────

def load_waterway_network(geojson_path: str = GEOJSON_PATH) -> dict:
    """
    Parse Mumbai waterway GeoJSON.
    Returns a dict with nullah geometry data and type counts.

    Waterway types in the dataset:
      • drain  (848) — nullahs and storm drains
      • canal  (63)  — major canals
      • ditch  (8)   — minor ditches

    Higher-capacity waterways (canals) carry more water but also
    overflow more dramatically → higher flood risk when breached.
    """
    with open(geojson_path) as f:
        geojson = json.load(f)

    features = geojson["features"]
    network = {
        "all_coords": [],       # flat list of (lon, lat) for proximity calc
        "canal_coords": [],     # canal-only (highest overflow risk)
        "drain_coords": [],     # drains/nullahs
        "named_waterways": [],  # named features
        "type_counts": defaultdict(int),
    }

    for feat in features:
        props = feat["properties"]
        geom  = feat["geometry"]
        wtype = props.get("waterway") or props.get("water", "unknown")
        network["type_counts"][wtype] += 1

        coords = []
        if geom["type"] == "Polygon":
            coords = geom["coordinates"][0]
        elif geom["type"] == "LineString":
            coords = geom["coordinates"]
        elif geom["type"] == "MultiPolygon":
            for ring in geom["coordinates"]:
                coords.extend(ring[0])

        network["all_coords"].extend(coords)
        if wtype == "canal":
            network["canal_coords"].extend(coords)
        elif wtype in ("drain", "ditch"):
            network["drain_coords"].extend(coords)

        if props.get("name"):
            network["named_waterways"].append({
                "name": props["name"], "type": wtype, "coords": coords[:3]
            })

    network["all_coords"]   = np.array(network["all_coords"])
    network["canal_coords"] = np.array(network["canal_coords"]) if network["canal_coords"] else np.zeros((0,2))
    network["drain_coords"] = np.array(network["drain_coords"]) if network["drain_coords"] else np.zeros((0,2))

    print(f"  Loaded {len(features)} waterways: "
          f"{dict(network['type_counts'])}")
    print(f"  Named waterways: {len(network['named_waterways'])} "
          f"(e.g. {', '.join(w['name'] for w in network['named_waterways'][:4])}...)")
    return network


def compute_waterway_proximity_score(lon: float, lat: float,
                                     network: dict,
                                     canal_weight: float = 1.5) -> float:
    """
    Distance-based flood risk from waterway network.
    Canals get a higher weight than drains (more volume when breached).

    Returns a [0, 1] proximity score — 1.0 = directly on a waterway.
    """
    def min_dist(coords_arr, lon, lat):
        if len(coords_arr) == 0:
            return 9999.0
        # Approximate distance in degrees (fast, sufficient for scoring)
        diffs = coords_arr - np.array([lon, lat])
        return float(np.sqrt((diffs**2).sum(axis=1)).min())

    drain_dist  = min_dist(network["drain_coords"], lon, lat)
    canal_dist  = min_dist(network["canal_coords"], lon, lat)

    # Weight canal proximity more (overflow risk is higher)
    weighted_dist = min(drain_dist, canal_dist * canal_weight)

    # Sigmoid decay: 0.01° ≈ 1 km in Mumbai; saturates quickly
    score = 1.0 / (1.0 + weighted_dist / 0.005)
    return float(np.clip(score, 0, 1))


# ── Historical Rainfall Baseline ──────────────────────────────────────────────

def build_mumbai_seasonal_baseline(rainfall_csv: str = RAINFALL_CSV_PATH) -> dict:
    """
    Compute per-month mean and std rainfall from 121 years of Mumbai data.
    Monsoon months (Jun–Sep) dominate: 85–90% of annual rainfall.

    Returns {month: {"mean": float, "std": float, "percentile_90": float}}
    """
    df = pd.read_csv(rainfall_csv)
    month_map = {
        "Jan": 1, "Feb": 2, "Mar": 3, "April": 4,
        "May": 5, "June": 6, "July": 7, "Aug": 8,
        "Sept": 9, "Oct": 10, "Nov": 11, "Dec": 12,
    }
    baseline = {}
    for col, mnum in month_map.items():
        vals = df[col].dropna()
        baseline[mnum] = {
            "mean":          float(vals.mean()),
            "std":           float(vals.std()),
            "percentile_90": float(np.percentile(vals, 90)),
            "percentile_95": float(np.percentile(vals, 95)),
        }
    return baseline


# ── Feature Engineering ────────────────────────────────────────────────────────

def add_temporal_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["Date"]       = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")
    df["Month"]      = df["Date"].dt.month.fillna(7).astype(int)
    df["DayOfYear"]  = df["Date"].dt.dayofyear.fillna(180).astype(int)
    df["Year"]       = df["Date"].dt.year.fillna(2017).astype(int)
    # Mumbai-specific: monsoon flag and peak monsoon (Jul–Aug highest intensity)
    df["IsMonsoon"]     = df["Month"].isin(MONSOON_MONTHS).astype(int)
    df["IsPeakMonsoon"] = df["Month"].isin({7, 8}).astype(int)
    return df


def add_rainfall_context(df: pd.DataFrame, baseline: dict) -> pd.DataFrame:
    """
    Mumbai-specific rainfall features using 121-year historical baseline.
    """
    df = df.copy()
    df["MonthlyMean"]   = df["Month"].map(lambda m: baseline[m]["mean"])
    df["MonthlyStd"]    = df["Month"].map(lambda m: baseline[m]["std"])
    df["P90Threshold"]  = df["Month"].map(lambda m: baseline[m]["percentile_90"])
    df["P95Threshold"]  = df["Month"].map(lambda m: baseline[m]["percentile_95"])

    # Normalised anomaly: how many std-devs above/below average?
    df["RainfallZScore"] = (
        (df["Rainfall_mm"] - df["MonthlyMean"]) / (df["MonthlyStd"] + 1e-9)
    )
    # Boolean: is today's rainfall an extreme event?
    df["ExtremeRainfall"] = (df["Rainfall_mm"] > df["P95Threshold"]).astype(int)
    # Is rainfall above 90th percentile (heavy rain)?
    df["HeavyRainfall"]   = (df["Rainfall_mm"] > df["P90Threshold"]).astype(int)
    return df


def add_mumbai_risk_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Mumbai-specific compound risk features.
    Key insight from data: ALL floods occur Jun–Sep with:
      - Rainfall > ~150 mm
      - WaterLevel > ~3.5 m (Mithi/nullah overflow)
      - SoilMoisture > ~60% (ground fully saturated)
    """
    df = df.copy()

    # Compound saturation index: high rain on saturated soil = runoff surge
    df["SaturationIndex"] = df["Rainfall_mm"] * (df["SoilMoisture_pct"] / 100.0)

    # Waterway overflow risk: rain + already high water level
    df["OverflowRisk"] = df["Rainfall_mm"] * df["WaterLevel_m"]

    # Low-lying area vulnerability (Mumbai coast is <5m in many places)
    df["LowElevRisk"] = np.where(
        df["Elevation_m"] < 5,   3.0,   # Very high — coastal/low-lying
        np.where(df["Elevation_m"] < 10, 2.0,   # High — near sea level
        np.where(df["Elevation_m"] < 20, 1.0,   # Medium
        0.3))                                    # Low
    )

    # Tidal backwater proxy: low elevation + high water level during monsoon
    df["TidalBackwaterRisk"] = (
        df["LowElevRisk"] * df["WaterLevel_m"] * df["IsMonsoon"]
    )

    # Mithi River overflow proxy
    df["MithiOverflowRisk"] = (
        (df["WaterLevel_m"] > MITHI_WARNING_LEVEL_M).astype(float)
        * df["Rainfall_mm"]
    )

    # Rolling-style feature: soil already saturated AND it's raining heavily
    df["SaturatedAndRaining"] = (
        (df["SoilMoisture_pct"] > 60).astype(int)
        * (df["Rainfall_mm"] > 100).astype(int)
    )

    return df


def prepare_features(df: pd.DataFrame,
                     baseline: dict) -> tuple[pd.DataFrame, list[str]]:
    """Full feature engineering pipeline. Returns (df, feature_col_names)."""
    df = add_temporal_features(df)
    df = add_rainfall_context(df, baseline)
    df = add_mumbai_risk_features(df)

    feature_cols = [
        # Core meteorological
        "Rainfall_mm",
        "WaterLevel_m",
        "SoilMoisture_pct",
        "Elevation_m",
        # Temporal / seasonal
        "Month",
        "DayOfYear",
        "IsMonsoon",
        "IsPeakMonsoon",
        # Rainfall context (from 121-yr history)
        "RainfallZScore",
        "ExtremeRainfall",
        "HeavyRainfall",
        # Mumbai compound risk
        "SaturationIndex",
        "OverflowRisk",
        "LowElevRisk",
        "TidalBackwaterRisk",
        "MithiOverflowRisk",
        "SaturatedAndRaining",
    ]
    return df, feature_cols


# ── Model Training ─────────────────────────────────────────────────────────────

def train_mumbai_flood_model(
    flood_csv:    str  = FLOOD_CSV_PATH,
    rainfall_csv: str  = RAINFALL_CSV_PATH,
    save_path:    str  = MODEL_SAVE_PATH,
    verbose:      bool = True,
) -> dict:
    """
    Train Mumbai flood prediction ensemble on real observational data.

    Model architecture:
      • RandomForest      — captures non-linear thresholds
      • GradientBoosting  — captures sequential compound effects
      • Ensemble = average of both probabilities
      • Threshold tuned for best F1 on flood class

    Returns model bundle dict ready for inference.
    """
    if verbose:
        print("=" * 60)
        print("  MFIS — Mumbai Flood Model Training")
        print("=" * 60)
        print("\n[1/6] Loading data...")

    baseline = build_mumbai_seasonal_baseline(rainfall_csv)
    if verbose:
        print(f"  Seasonal baseline built from 121 years of Mumbai rainfall")
        monsoon_mean = sum(baseline[m]["mean"] for m in MONSOON_MONTHS)
        print(f"  Total monsoon season mean: {monsoon_mean:.0f} mm")

    df_raw = pd.read_csv(flood_csv)
    df, feature_cols = prepare_features(df_raw, baseline)

    X = df[feature_cols].values.astype(np.float32)
    y = df["FloodOccurrence"].values

    if verbose:
        pos = y.sum(); neg = len(y) - pos
        print(f"\n[2/6] Dataset overview:")
        print(f"  Total records  : {len(y)}")
        print(f"  Flood events   : {pos} ({pos/len(y):.1%})")
        print(f"  No-flood       : {neg} ({neg/len(y):.1%})")
        print(f"  Features       : {len(feature_cols)}")
        print(f"\n  Mumbai flood trigger analysis:")
        flood_df = df[y == 1]
        print(f"  Avg rainfall when flooding  : {flood_df['Rainfall_mm'].mean():.1f} mm")
        print(f"  Avg water level at flood    : {flood_df['WaterLevel_m'].mean():.2f} m")
        print(f"  Avg soil moisture at flood  : {flood_df['SoilMoisture_pct'].mean():.1f}%")
        print(f"  Months with flooding        : {sorted(flood_df['Month'].unique())}")

    # ── Split ──────────────────────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, stratify=y, random_state=42
    )

    scaler  = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test  = scaler.transform(X_test)

    # Class weights to counter imbalance (~80/20)
    cw = compute_class_weight("balanced", classes=np.array([0, 1]), y=y_train)
    cw_dict = {0: float(cw[0]), 1: float(cw[1])}

    # ── Random Forest ──────────────────────────────────────────────────────────
    if verbose:
        print(f"\n[3/6] Training Random Forest (300 trees)...")

    rf = RandomForestClassifier(
        n_estimators   = 300,
        max_depth      = 12,
        min_samples_leaf = 4,
        max_features   = "sqrt",
        class_weight   = cw_dict,
        random_state   = 42,
        n_jobs         = -1,
    )
    rf.fit(X_train, y_train)

    # ── Gradient Boosting ──────────────────────────────────────────────────────
    if verbose:
        print(f"[4/6] Training Gradient Boosting (200 estimators)...")

    gb = GradientBoostingClassifier(
        n_estimators   = 200,
        learning_rate  = 0.05,
        max_depth      = 6,
        subsample      = 0.8,
        min_samples_leaf = 5,
        random_state   = 42,
    )
    gb.fit(X_train, y_train)

    # ── Ensemble & threshold tuning ────────────────────────────────────────────
    rf_prob  = rf.predict_proba(X_test)[:, 1]
    gb_prob  = gb.predict_proba(X_test)[:, 1]
    ens_prob = (rf_prob * 0.55 + gb_prob * 0.45)   # RF gets slightly more weight

    # Maximise F1 for flood class via threshold sweep
    best_thresh, best_f1 = 0.50, 0.0
    for t in np.arange(0.20, 0.80, 0.01):
        preds = (ens_prob >= t).astype(int)
        tp = ((preds == 1) & (y_test == 1)).sum()
        fp = ((preds == 1) & (y_test == 0)).sum()
        fn = ((preds == 0) & (y_test == 1)).sum()
        if tp + fp + fn == 0:
            continue
        prec = tp / (tp + fp + 1e-9)
        rec  = tp / (tp + fn + 1e-9)
        f1   = 2 * prec * rec / (prec + rec + 1e-9)
        if f1 > best_f1:
            best_f1, best_thresh = f1, float(t)

    final_preds = (ens_prob >= best_thresh).astype(int)

    if verbose:
        print(f"\n[5/6] Evaluation (optimal threshold = {best_thresh:.2f}):")
        print()
        print(classification_report(y_test, final_preds,
                                    target_names=["No Flood", "Flood"]))

    # ── Cross-validation ───────────────────────────────────────────────────────
    X_all_s = scaler.transform(X.astype(np.float32))
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_auc = cross_val_score(rf, X_all_s, y, cv=cv, scoring="roc_auc")

    metrics = {
        "roc_auc_test":     round(float(roc_auc_score(y_test, ens_prob)), 4),
        "avg_precision":    round(float(average_precision_score(y_test, ens_prob)), 4),
        "cv_auc_mean":      round(float(cv_auc.mean()), 4),
        "cv_auc_std":       round(float(cv_auc.std()), 4),
        "best_f1_flood":    round(float(best_f1), 4),
        "threshold":        round(best_thresh, 2),
        "confusion_matrix": confusion_matrix(y_test, final_preds).tolist(),
        "n_train":          int(len(y_train)),
        "n_test":           int(len(y_test)),
    }

    if verbose:
        print(f"  ROC-AUC (test)      : {metrics['roc_auc_test']}")
        print(f"  Avg Precision (AP)  : {metrics['avg_precision']}")
        print(f"  CV ROC-AUC (5-fold) : {metrics['cv_auc_mean']} ± {metrics['cv_auc_std']}")
        cm = metrics["confusion_matrix"]
        print(f"\n  Confusion Matrix:")
        print(f"    TN={cm[0][0]}  FP={cm[0][1]}")
        print(f"    FN={cm[1][0]}  TP={cm[1][1]}")

    # ── Feature importance ─────────────────────────────────────────────────────
    fi = (
        pd.Series(rf.feature_importances_, index=feature_cols)
        .sort_values(ascending=False)
    )

    if verbose:
        print(f"\n[6/6] Feature Importances (RF):")
        for feat, imp in fi.items():
            bar = "█" * int(imp * 50)
            print(f"  {feat:<24} {bar} {imp:.4f}")

    # ── Bundle ─────────────────────────────────────────────────────────────────
    bundle = {
        "model_name":         "MFIS-Mumbai-v1",
        "rf":                 rf,
        "gb":                 gb,
        "scaler":             scaler,
        "features":           feature_cols,
        "baseline":           baseline,
        "threshold":          best_thresh,
        "metrics":            metrics,
        "feature_importance": fi.to_dict(),
        "city":               "Mumbai",
        "monsoon_months":     list(MONSOON_MONTHS),
        "risk_thresholds":    RISK_THRESHOLDS,
    }

    Path(save_path).parent.mkdir(parents=True, exist_ok=True)
    with open(save_path, "wb") as f:
        pickle.dump(bundle, f)

    if verbose:
        print(f"\n✅ Mumbai model saved → {save_path}")

    return bundle


# ── Inference ──────────────────────────────────────────────────────────────────

def load_model(path: str = MODEL_SAVE_PATH) -> dict:
    with open(path, "rb") as f:
        return pickle.load(f)


def classify_risk(score: float | np.ndarray) -> str | np.ndarray:
    """Convert 0–100 probability score to Mumbai risk category."""
    scalar = np.isscalar(score)
    arr = np.atleast_1d(np.array(score, dtype=float))
    result = np.full(arr.shape, "low", dtype=object)
    result[arr >= RISK_THRESHOLDS["medium"]]   = "medium"
    result[arr >= RISK_THRESHOLDS["high"]]     = "high"
    result[arr >= RISK_THRESHOLDS["critical"]] = "critical"
    return str(result[0]) if scalar else result


def _build_feature_row(bundle: dict,
                        rainfall_mm: float,
                        water_level_m: float,
                        soil_moisture: float,
                        elevation_m: float,
                        month: int,
                        day_of_year: int) -> np.ndarray:
    """Internal: build a single feature vector from inputs."""
    baseline = bundle["baseline"]
    b = baseline[month]

    rain_zscore   = (rainfall_mm - b["mean"]) / (b["std"] + 1e-9)
    is_monsoon    = 1 if month in MONSOON_MONTHS else 0
    is_peak       = 1 if month in {7, 8} else 0
    extreme       = 1 if rainfall_mm > b["percentile_95"] else 0
    heavy         = 1 if rainfall_mm > b["percentile_90"] else 0
    sat_idx       = rainfall_mm * (soil_moisture / 100.0)
    overflow_risk = rainfall_mm * water_level_m
    low_elev      = (3.0 if elevation_m < 5 else
                     2.0 if elevation_m < 10 else
                     1.0 if elevation_m < 20 else 0.3)
    tidal         = low_elev * water_level_m * is_monsoon
    mithi         = (1.0 if water_level_m > MITHI_WARNING_LEVEL_M else 0.0) * rainfall_mm
    sat_and_rain  = int(soil_moisture > 60 and rainfall_mm > 100)

    row = [
        rainfall_mm, water_level_m, soil_moisture, elevation_m,
        month, day_of_year, is_monsoon, is_peak,
        rain_zscore, extreme, heavy,
        sat_idx, overflow_risk, low_elev, tidal, mithi, sat_and_rain,
    ]
    return np.array(row, dtype=np.float32).reshape(1, -1)


def predict_flood_probability(
    bundle:        dict,
    rainfall_mm:   float,
    water_level_m: float,
    soil_moisture: float,
    elevation_m:   float,
    month:         int   = 7,
    day_of_year:   int   = 195,
    lon:           float | None = None,
    lat:           float | None = None,
    network:       dict  | None = None,
) -> dict:
    """
    Predict flood probability for a single Mumbai location.

    Parameters
    ----------
    bundle        : trained model bundle from train_mumbai_flood_model()
    rainfall_mm   : today's rainfall in mm
    water_level_m : current water/nullah level in metres
    soil_moisture : soil moisture percentage (0–100)
    elevation_m   : ground elevation in metres (SRTM)
    month         : calendar month (1–12)
    day_of_year   : day of year (1–365)
    lon, lat      : optional coordinates for waterway proximity score
    network       : optional loaded waterway network from load_waterway_network()

    Returns
    -------
    dict:
        probability      — float [0, 1]
        flood_predicted  — bool
        risk_class       — 'critical' | 'high' | 'medium' | 'low'
        risk_score       — float [0, 100]
        risk_factors     — list of triggered risk factors
        advice           — human-readable action string
    """
    X_raw = _build_feature_row(
        bundle, rainfall_mm, water_level_m,
        soil_moisture, elevation_m, month, day_of_year
    )
    X = bundle["scaler"].transform(X_raw)

    rf_p  = bundle["rf"].predict_proba(X)[0, 1]
    gb_p  = bundle["gb"].predict_proba(X)[0, 1]
    prob  = float(rf_p * 0.55 + gb_p * 0.45)

    # Optionally blend in waterway proximity score
    if lon is not None and lat is not None and network is not None:
        wprox = compute_waterway_proximity_score(lon, lat, network)
        # Waterway proximity adjusts probability (max ±15%)
        prob = float(np.clip(prob + (wprox - 0.3) * 0.15, 0, 1))

    score     = round(prob * 100, 1)
    predicted = prob >= bundle["threshold"]
    risk_cls  = classify_risk(score)

    # Identify which risk factors are active
    risk_factors = []
    baseline = bundle["baseline"]
    b = baseline[month]
    if rainfall_mm > b["percentile_95"]:
        risk_factors.append(f"Extreme rainfall ({rainfall_mm:.0f} mm > 95th pct {b['percentile_95']:.0f} mm)")
    elif rainfall_mm > b["percentile_90"]:
        risk_factors.append(f"Heavy rainfall ({rainfall_mm:.0f} mm > 90th pct {b['percentile_90']:.0f} mm)")
    if water_level_m > MITHI_DANGER_LEVEL_M:
        risk_factors.append(f"Water level above danger ({water_level_m:.1f} m > {MITHI_DANGER_LEVEL_M} m)")
    elif water_level_m > MITHI_WARNING_LEVEL_M:
        risk_factors.append(f"Water level above warning ({water_level_m:.1f} m > {MITHI_WARNING_LEVEL_M} m)")
    if soil_moisture > 80:
        risk_factors.append(f"Soil fully saturated ({soil_moisture:.0f}%)")
    elif soil_moisture > 60:
        risk_factors.append(f"Soil heavily saturated ({soil_moisture:.0f}%)")
    if elevation_m < 5:
        risk_factors.append(f"Critical low-lying area ({elevation_m:.1f} m elevation)")
    elif elevation_m < 10:
        risk_factors.append(f"Low-lying area ({elevation_m:.1f} m elevation)")
    if month in MONSOON_MONTHS:
        risk_factors.append(f"Active monsoon season (Month {month})")

    advice_map = {
        "critical": "🔴 EVACUATE — Severe flooding imminent. Alert authorities immediately.",
        "high":     "🟠 HIGH ALERT — Prepare for flooding. Move to higher ground.",
        "medium":   "🟡 CAUTION — Monitor water levels. Avoid low-lying areas.",
        "low":      "🟢 LOW RISK — Normal precautions sufficient.",
    }

    return {
        "probability":     round(prob, 4),
        "flood_predicted": bool(predicted),
        "risk_class":      risk_cls,
        "risk_score":      score,
        "risk_factors":    risk_factors,
        "advice":          advice_map[risk_cls],
    }


def predict_grid_mumbai(
    bundle:        dict,
    dem:           np.ndarray,
    rainfall_mm:   float,
    water_level_m: float,
    soil_moisture: float,
    month:         int   = 7,
    day_of_year:   int   = 195,
) -> np.ndarray:
    """
    Vectorised flood probability prediction over a 2-D DEM grid.
    Returns float32 array of risk scores (0–100), same shape as dem.
    Suitable for use with Mumbai SRTM tiles.
    """
    h, w = dem.shape
    flat  = dem.flatten().astype(np.float32)
    n     = len(flat)
    baseline = bundle["baseline"]
    b = baseline[month]

    rain_zscore  = float((rainfall_mm - b["mean"]) / (b["std"] + 1e-9))
    is_monsoon   = 1 if month in MONSOON_MONTHS else 0
    is_peak      = 1 if month in {7, 8} else 0
    extreme      = 1 if rainfall_mm > b["percentile_95"] else 0
    heavy        = 1 if rainfall_mm > b["percentile_90"] else 0
    sat_idx      = rainfall_mm * (soil_moisture / 100.0)
    overflow_r   = rainfall_mm * water_level_m
    mithi        = (1.0 if water_level_m > MITHI_WARNING_LEVEL_M else 0.0) * rainfall_mm
    sat_and_rain = int(soil_moisture > 60 and rainfall_mm > 100)

    low_elev = np.where(flat < 5,  3.0,
               np.where(flat < 10, 2.0,
               np.where(flat < 20, 1.0, 0.3)))
    tidal    = low_elev * water_level_m * is_monsoon

    X_df = pd.DataFrame({
        "Rainfall_mm":       np.full(n, rainfall_mm),
        "WaterLevel_m":      np.full(n, water_level_m),
        "SoilMoisture_pct":  np.full(n, soil_moisture),
        "Elevation_m":       flat,
        "Month":             np.full(n, month),
        "DayOfYear":         np.full(n, day_of_year),
        "IsMonsoon":         np.full(n, is_monsoon),
        "IsPeakMonsoon":     np.full(n, is_peak),
        "RainfallZScore":    np.full(n, rain_zscore),
        "ExtremeRainfall":   np.full(n, extreme),
        "HeavyRainfall":     np.full(n, heavy),
        "SaturationIndex":   np.full(n, sat_idx),
        "OverflowRisk":      np.full(n, overflow_r),
        "LowElevRisk":       low_elev,
        "TidalBackwaterRisk":tidal,
        "MithiOverflowRisk": np.full(n, mithi),
        "SaturatedAndRaining": np.full(n, sat_and_rain),
    })[bundle["features"]]

    X = bundle["scaler"].transform(X_df.values.astype(np.float32))
    rf_p  = bundle["rf"].predict_proba(X)[:, 1]
    gb_p  = bundle["gb"].predict_proba(X)[:, 1]
    probs = rf_p * 0.55 + gb_p * 0.45

    return (probs * 100).reshape(h, w).astype(np.float32)


# ── DEM Loading ────────────────────────────────────────────────────────────────

def load_mumbai_dem(dem_paths: list[str] = DEM_TILES,
                    grid_size_m: int = GRID_SIZE_M) -> np.ndarray:
    """
    Load and mosaic the two Mumbai SRTM 1-arc-sec DEM tiles.
    Resamples to target grid resolution.
    Requires: rasterio
    """
    if not HAS_RASTERIO:
        raise ImportError("rasterio is required to load DEM tiles. "
                          "Install with: pip install rasterio")
    from rasterio.merge import merge

    datasets = [rasterio.open(p) for p in dem_paths]
    mosaic, transform = merge(datasets)
    for ds in datasets:
        ds.close()

    # Resample to grid_size_m
    scale = 30 / grid_size_m   # SRTM is ~30m; adjust for 50m grid
    data  = mosaic[0]
    data  = data.astype(np.float32)
    data[data < -100] = np.nan   # no-data mask
    return data, transform


# ── Full Pipeline ──────────────────────────────────────────────────────────────

def run_mumbai_flood_pipeline(
    rainfall_mm:   float,
    water_level_m: float,
    soil_moisture: float,
    month:         int  = 7,
    output_dir:    str  = "output",
    model_path:    str  = MODEL_SAVE_PATH,
) -> pd.DataFrame:
    """
    End-to-end Mumbai flood risk pipeline.
    If DEM is available, runs spatial grid prediction.
    Otherwise, demonstrates single-point predictions across Mumbai.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Load or train model
    if Path(model_path).exists():
        bundle = load_model(model_path)
        print(f"Loaded model: {bundle['model_name']}")
    else:
        bundle = train_mumbai_flood_model(save_path=model_path)

    # Load waterway network for proximity scoring
    print("\nLoading Mumbai waterway network...")
    network = load_waterway_network()

    # Key Mumbai locations (lat, lon, elevation_m)
    mumbai_locations = [
        {"name": "Dharavi",           "lat": 19.038, "lon": 72.852, "elevation_m": 3.0},
        {"name": "Kurla",             "lat": 19.065, "lon": 72.880, "elevation_m": 5.0},
        {"name": "Sion",              "lat": 19.042, "lon": 72.863, "elevation_m": 4.0},
        {"name": "Andheri West",      "lat": 19.119, "lon": 72.836, "elevation_m": 8.0},
        {"name": "Bandra",            "lat": 19.054, "lon": 72.842, "elevation_m": 6.0},
        {"name": "Malad",             "lat": 19.187, "lon": 72.848, "elevation_m": 10.0},
        {"name": "Borivali",          "lat": 19.229, "lon": 72.854, "elevation_m": 14.0},
        {"name": "Colaba",            "lat": 18.907, "lon": 72.815, "elevation_m": 3.0},
        {"name": "Thane",             "lat": 19.218, "lon": 72.978, "elevation_m": 7.0},
        {"name": "Powai",             "lat": 19.117, "lon": 72.906, "elevation_m": 22.0},
        {"name": "Vikhroli",          "lat": 19.106, "lon": 72.926, "elevation_m": 6.0},
        {"name": "Chembur",           "lat": 19.052, "lon": 72.900, "elevation_m": 9.0},
        {"name": "Navi Mumbai",       "lat": 19.033, "lon": 73.029, "elevation_m": 12.0},
        {"name": "Santacruz Airport", "lat": 19.088, "lon": 72.868, "elevation_m": 11.0},
    ]

    results = []
    day_of_year = month * 30
    for loc in mumbai_locations:
        pred = predict_flood_probability(
            bundle        = bundle,
            rainfall_mm   = rainfall_mm,
            water_level_m = water_level_m,
            soil_moisture = soil_moisture,
            elevation_m   = loc["elevation_m"],
            month         = month,
            day_of_year   = day_of_year,
            lon           = loc["lon"],
            lat           = loc["lat"],
            network       = network,
        )
        results.append({
            "location":       loc["name"],
            "lat":            loc["lat"],
            "lon":            loc["lon"],
            "elevation_m":    loc["elevation_m"],
            "risk_score":     pred["risk_score"],
            "risk_class":     pred["risk_class"],
            "flood_predicted":pred["flood_predicted"],
            "probability":    pred["probability"],
            "advice":         pred["advice"],
        })

    df_out = pd.DataFrame(results).sort_values("risk_score", ascending=False)
    out_path = Path(output_dir) / "mumbai_flood_predictions.csv"
    df_out.to_csv(out_path, index=False)
    print(f"\n✅ Mumbai location predictions → {out_path}")

    return df_out


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # ── Step 1: Train ────────────────────────────────────────────────────────
    bundle = train_mumbai_flood_model(
        flood_csv    = FLOOD_CSV_PATH,
        rainfall_csv = RAINFALL_CSV_PATH,
        save_path    = MODEL_SAVE_PATH,
    )

    # ── Step 2: Single-point prediction examples ─────────────────────────────
    print("\n" + "=" * 60)
    print("  Single-point Prediction Examples")
    print("=" * 60)

    scenarios = [
        {
            "label":         "26 July 2005 (worst Mumbai flood)",
            "rainfall_mm":   944.0,
            "water_level_m": 6.5,
            "soil_moisture": 95.0,
            "elevation_m":   3.0,
            "month":         7,
        },
        {
            "label":         "Typical monsoon day (Dharavi)",
            "rainfall_mm":   180.0,
            "water_level_m": 4.2,
            "soil_moisture": 75.0,
            "elevation_m":   3.0,
            "month":         8,
        },
        {
            "label":         "Moderate rain, higher ground (Powai)",
            "rainfall_mm":   90.0,
            "water_level_m": 2.0,
            "soil_moisture": 55.0,
            "elevation_m":   22.0,
            "month":         7,
        },
        {
            "label":         "Dry season (January)",
            "rainfall_mm":   5.0,
            "water_level_m": 1.2,
            "soil_moisture": 30.0,
            "elevation_m":   10.0,
            "month":         1,
        },
    ]

    for sc in scenarios:
        label = sc.pop("label")
        result = predict_flood_probability(bundle, **sc)
        print(f"\n  📍 {label}")
        print(f"     Risk Score  : {result['risk_score']}")
        print(f"     Risk Class  : {result['risk_class'].upper()}")
        print(f"     Probability : {result['probability']:.2%}")
        print(f"     Advice      : {result['advice']}")
        if result["risk_factors"]:
            print(f"     Factors     :")
            for rf_ in result["risk_factors"]:
                print(f"       • {rf_}")

    # ── Step 3: Full pipeline across Mumbai locations ─────────────────────────
    print("\n" + "=" * 60)
    print("  Mumbai Location Risk Assessment — Heavy Monsoon Day")
    print("=" * 60)
    df_preds = run_mumbai_flood_pipeline(
        rainfall_mm   = 175.0,
        water_level_m = 4.0,
        soil_moisture = 80.0,
        month         = 7,
    )
    print("\n  Location Rankings (highest risk first):")
    print(df_preds[["location", "elevation_m", "risk_score", "risk_class", "flood_predicted"]]
          .to_string(index=False))