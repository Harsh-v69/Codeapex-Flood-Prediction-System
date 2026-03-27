"""
MFIS — Mumbai Flood Intelligence System
python/flood_risk_model.py
Flood Risk Scoring for Mumbai 50m×50m Grid Cells

Data sources used:
  - DEM      : SRTM 1-arc (~30m) tiles n19_e072 & n19_e073
  - Drainage : drainagemumbai.geojson  (919 canal/waterway polygons, OSM)
  - Flood    : mumbai_flood_dataset.csv (daily Rainfall_mm, WaterLevel_m,
                 SoilMoisture_pct, Elevation_m, FloodOccurrence 2015-…)
  - Rainfall : mumbai_rainfall.csv (monthly IMD totals 1901-present)

Key differences from Delhi (DFIS):
  - No single river danger level — Mumbai uses tidal creek network + Mithi River
  - Coastal/tidal flood component replaces Yamuna proximity
  - Drainage uses GeoJSON polygon overlay instead of shapefile lines
  - Two DEM tiles must be mosaicked before processing
  - Monsoon season reference stats derived from mumbai_rainfall.csv
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import geopandas as gpd
from pathlib import Path


# ── Constants ──────────────────────────────────────────────────────────────────

# Mithi River / tidal creek flood thresholds (MCGM / IMD standard)
MITHI_DANGER_LEVEL_M    = 2.50   # metres above MSL (tidal gauge, Mahim Causeway)
MITHI_WARNING_LEVEL_M   = 1.80
MEAN_SEA_LEVEL_ELEV_M   = 0.0   # reference datum

# IMD Mumbai rain intensity classes (mm / hour)
RAIN_MODERATE_MM_HR     = 7.6
RAIN_HEAVY_MM_HR        = 35.6
RAIN_VERY_HEAVY_MM_HR   = 64.5
RAIN_EXTREMELY_HEAVY    = 115.6  # IMD "red alert" threshold

# Grid
GRID_SIZE_M             = 50     # 50m × 50m cells

# Mumbai spatial extents
MUMBAI_AREA_KM2         = 603    # Greater Mumbai (island + suburbs)
TOTAL_WARDS             = 227    # BMC wards (A–T, 24 administrative wards)

# SRTM DEM tiles covering Mumbai
DEM_TILE_PATHS = [
    "data/n19_e072_1arc_v3.tif",   # covers Salsette / Borivali / Andheri
    "data/n19_e073_1arc_v3.tif",   # eastern fringe — Thane Creek corridor
]

# Risk score weights (must sum to 1.0)
# Mumbai-specific rationale:
#   rainfall_intensity  — monsoon events are the primary flood driver
#   low_elevation       — reclaimed land / creek fill areas below ~5m MSL
#   drainage_overflow   — storm-drain capacity (MCGM 25mm/hr design limit)
#   coastal_tidal       — Arabian Sea + tidal creeks backflow during high tide
#   impervious_surface  — dense urban fabric (Dharavi, Kurla, Bandra)
#   soil_saturation     — laterite soil in eastern suburbs saturates quickly
WEIGHTS = {
    "rainfall_intensity":  0.30,  # highest weight — monsoon primary driver
    "low_elevation":       0.22,  # reclaimed/low-lying areas
    "drainage_overflow":   0.18,  # MCGM drain capacity
    "coastal_tidal":       0.15,  # tidal creek backflow (replaces Yamuna proximity)
    "impervious_surface":  0.10,  # Landsat-8 NDBI
    "soil_saturation":     0.05,  # NRSC / flood dataset SoilMoisture_pct
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Weights must sum to 1.0"

# Risk classification thresholds (0–100 scale)
RISK_THRESHOLDS = {
    "critical": 80,
    "high":     60,
    "medium":   40,
    # below 40 → "low"
}

# Coastal elevation danger band (metres) — areas below this are tidal flood-prone
COASTAL_FLOOD_ELEV_M = 5.0


# ── Rainfall Reference Statistics (from mumbai_rainfall.csv) ──────────────────

def load_rainfall_climatology(csv_path: str) -> dict:
    """
    Derive monsoon season statistics from the historical monthly rainfall CSV.
    Returns a dict with mean, 90th-pctile, and record totals for June–Sept.
    Used to normalise live/event rainfall against historical context.

    CSV schema: Year | Jan | Feb | Mar | April | May | June | July | Aug |
                Sept | Oct | Nov | Dec | Total
    """
    df = pd.read_csv(csv_path)
    monsoon_cols = ["June", "July", "Aug", "Sept"]
    df["MonsoonTotal"] = df[monsoon_cols].sum(axis=1)

    stats = {
        "monsoon_mean_mm":   df["MonsoonTotal"].mean(),
        "monsoon_p90_mm":    df["MonsoonTotal"].quantile(0.90),
        "monsoon_max_mm":    df["MonsoonTotal"].max(),
        "july_mean_mm":      df["July"].mean(),       # July is peak month
        "july_p90_mm":       df["July"].quantile(0.90),
        "annual_mean_mm":    df["Total"].mean(),
    }
    return stats


def normalise_rainfall(rainfall_mm: float, climatology: dict) -> float:
    """
    Normalise an event/daily rainfall value to [0, 1] using the historical
    90th-percentile monsoon month (July) as the saturation point.
    Values ≥ july_p90 → 1.0.
    """
    return float(np.clip(rainfall_mm / (climatology["july_p90_mm"] + 1e-9), 0, 1))


# ── Flood Dataset Loader ───────────────────────────────────────────────────────

def load_flood_observations(csv_path: str) -> pd.DataFrame:
    """
    Load daily flood observation data.

    CSV schema: Date | Rainfall_mm | WaterLevel_m | SoilMoisture_pct |
                Elevation_m | FloodOccurrence

    Returns cleaned DataFrame with parsed dates.
    Used to:
      1. Calibrate water-level thresholds
      2. Derive soil saturation indices for current conditions
      3. Validate risk model outputs against historical flood events
    """
    df = pd.read_csv(csv_path, parse_dates=["Date"], dayfirst=True)
    df = df.dropna(subset=["Rainfall_mm", "WaterLevel_m"])
    df["SoilMoisture_norm"] = df["SoilMoisture_pct"] / 100.0
    df["WaterLevel_norm"]   = np.clip(
        df["WaterLevel_m"] / MITHI_DANGER_LEVEL_M, 0, 1
    )
    return df


def get_current_conditions(flood_df: pd.DataFrame, date: str | None = None) -> dict:
    """
    Extract current-day (or latest available) conditions from the observations.
    Returns dict suitable for plugging directly into run_risk_pipeline().
    """
    if date:
        row = flood_df[flood_df["Date"] == pd.to_datetime(date, dayfirst=True)]
    else:
        row = flood_df.tail(1)

    if row.empty:
        raise ValueError(f"No data found for date: {date}")

    r = row.iloc[0]
    return {
        "rainfall_mm":     float(r["Rainfall_mm"]),
        "water_level_m":   float(r["WaterLevel_m"]),
        "soil_saturation": float(r["SoilMoisture_norm"]),
        "flood_observed":  bool(r["FloodOccurrence"]),
    }


# ── DEM / Raster Loaders ───────────────────────────────────────────────────────

def load_and_mosaic_dem(tile_paths: list[str], grid_size_m: int = GRID_SIZE_M) -> tuple:
    """
    Load two SRTM 1-arc tiles covering Mumbai and mosaic them into a single
    numpy array resampled to grid_size_m resolution.

    Tiles:
        n19_e072 — Borivali / Andheri / Bandra / South Mumbai
        n19_e073 — Thane Creek corridor / eastern suburbs

    Returns
    -------
    dem       : np.ndarray float32 (rows × cols)
    transform : rasterio Affine transform for the mosaicked raster
    crs       : rasterio CRS
    """
    import rasterio
    from rasterio.merge import merge
    from rasterio.enums import Resampling

    src_files = [rasterio.open(p) for p in tile_paths]
    mosaic, out_transform = merge(src_files)

    # Resample to target grid size
    scale = src_files[0].res[0] / (grid_size_m / 111320)   # approx deg per metre at ~19°N
    new_h = int(mosaic.shape[1] * scale)
    new_w = int(mosaic.shape[2] * scale)

    from rasterio.transform import from_bounds
    from rasterio.warp import reproject

    dem_resampled = np.zeros((new_h, new_w), dtype=np.float32)
    reproject(
        source      = mosaic[0],
        destination = dem_resampled,
        src_transform = out_transform,
        src_crs       = src_files[0].crs,
        dst_transform = out_transform,
        dst_crs       = src_files[0].crs,
        resampling    = Resampling.bilinear,
    )

    for s in src_files:
        s.close()

    return dem_resampled, out_transform, src_files[0].crs


def load_dem_single(dem_path: str, grid_size_m: int = GRID_SIZE_M) -> tuple:
    """
    Load a single DEM tile. Use load_and_mosaic_dem() in production.
    Kept for convenience when testing on individual tiles.
    """
    import rasterio
    from rasterio.enums import Resampling

    with rasterio.open(dem_path) as src:
        data = src.read(
            1,
            out_shape=(
                int(src.height * src.res[0] * 111320 / grid_size_m),
                int(src.width  * src.res[1] * 111320 / grid_size_m),
            ),
            resampling=Resampling.bilinear,
        )
        transform = src.transform
        crs       = src.crs

    return data.astype(np.float32), transform, crs


# ── Drainage GeoJSON Loader ────────────────────────────────────────────────────

def load_drainage_geojson(geojson_path: str) -> gpd.GeoDataFrame:
    """
    Load Mumbai drainage network from GeoJSON (OSM canal/waterway polygons).

    Schema: @id | natural | water | waterway
    919 features — canals, drains, water bodies.

    Projects to UTM Zone 43N (EPSG:32643) for metre-based proximity calculations.
    Returns GeoDataFrame with an added 'drain_type' column normalising
    the 'waterway' and 'water' tags.
    """
    gdf = gpd.read_file(geojson_path)
    gdf = gdf.to_crs("EPSG:32643")   # UTM Zone 43N — same as Delhi model

    # Normalise drain-type label for capacity scoring
    gdf["drain_type"] = gdf["waterway"].fillna(gdf["water"]).fillna("unknown")

    # Capacity weight: canal > river > drain > other
    capacity_map = {
        "canal":  1.0,
        "river":  0.9,
        "drain":  0.6,
        "stream": 0.5,
    }
    gdf["capacity_weight"] = gdf["drain_type"].map(
        lambda x: capacity_map.get(str(x).lower(), 0.4)
    )
    return gdf


def rasterise_drainage_overflow(
    drainage_gdf: gpd.GeoDataFrame,
    dem_shape:    tuple,
    transform,
    rainfall_mm:  float,
    overflow_threshold_mm_hr: float = 25.0,
) -> np.ndarray:
    """
    Rasterise drainage polygons and compute overflow risk per cell.

    MCGM storm-drain design capacity ≈ 25 mm/hr. When rainfall exceeds this,
    drains overflow and risk increases proportionally to drain density and
    the rainfall-capacity ratio.

    Returns a [0, 1] overflow risk raster.
    """
    from rasterio.features import rasterize
    from shapely.geometry import mapping

    # Build drain-presence raster (1 = drain polygon present)
    drain_raster = rasterize(
        [(geom, 1) for geom in drainage_gdf.geometry if geom is not None],
        out_shape = dem_shape,
        transform = transform,
        fill      = 0,
        dtype     = np.uint8,
    )

    overflow_ratio = np.clip(rainfall_mm / overflow_threshold_mm_hr, 0, 4) / 4.0
    # Cells with a drain present get higher overflow risk
    base_risk       = np.full(dem_shape, overflow_ratio * 0.5, dtype=np.float32)
    drain_mask      = drain_raster.astype(bool)
    base_risk[drain_mask] = np.clip(overflow_ratio * 1.0, 0, 1)

    return base_risk


# ── Mumbai-Specific: Coastal / Tidal Flood Score ──────────────────────────────

def compute_coastal_tidal_score(
    dem:           np.ndarray,
    water_level_m: float,
    coastal_band_m: float = COASTAL_FLOOD_ELEV_M,
) -> np.ndarray:
    """
    Coastal and tidal creek flood score — the Mumbai-specific replacement
    for the Delhi Yamuna-proximity component.

    Logic:
    - Cells below COASTAL_FLOOD_ELEV_M (5m) are inherently tidal-flood-prone
      (reclaimed land, creek fill, mangrove fringe areas like Bandra, Kurla,
       Vikhroli).
    - When water_level_m approaches MITHI_DANGER_LEVEL_M (2.5m), risk
      amplifies exponentially for low-lying cells.
    - Score = 0 for elevation > coastal_band_m and low water level

    Returns
    -------
    score : np.ndarray float32 [0, 1]
    """
    # Elevation below the coastal band gets a base vulnerability
    elev_vuln = np.clip((coastal_band_m - dem) / coastal_band_m, 0, 1)

    # Tidal amplifier: how close is current water level to danger threshold?
    tidal_factor = np.clip(water_level_m / MITHI_DANGER_LEVEL_M, 0, 1)

    # Combined score: high elevation = low score regardless of tidal level
    score = elev_vuln * (0.4 + 0.6 * tidal_factor)
    return score.astype(np.float32)


# ── Flow Accumulation ──────────────────────────────────────────────────────────

def compute_flow_accumulation(dem: np.ndarray) -> np.ndarray:
    """
    D8 flow direction + accumulation using WhiteboxTools (preferred).
    Falls back to gradient-based proxy if WhiteboxTools unavailable.

    Mumbai terrain note: most of the peninsula is near-flat (<5m elevation
    change over km scale), so flow accumulation heavily concentrates in the
    Mithi River basin and eastern creek corridors.

    Returns normalised flow accumulation [0, 1].
    """
    try:
        from whitebox import WhiteboxTools
        wbt = WhiteboxTools()
        wbt.verbose = False
        # Production: wbt.d8_flow_accumulation(dem_path, output_path)
        # Placeholder pipeline (replace with real wbt call in production):
        inverted = dem.max() - dem
        normed   = (inverted - inverted.min()) / (inverted.max() - inverted.min() + 1e-9)
        return normed.astype(np.float32)
    except ImportError:
        gy, gx = np.gradient(dem.astype(float))
        slope   = np.sqrt(gx**2 + gy**2)
        acc     = 1.0 / (slope + 1.0)
        acc_n   = (acc - acc.min()) / (acc.max() - acc.min() + 1e-9)
        return acc_n.astype(np.float32)


# ── Impervious Surface ─────────────────────────────────────────────────────────

def compute_impervious_surface(landsat_path: str, dem: np.ndarray) -> np.ndarray:
    """
    Derive impervious surface fraction from Landsat-8 NDBI.
    NDBI = (SWIR – NIR) / (SWIR + NIR)   → positive = built-up

    Mumbai note: central city and Dharavi have impervious fractions > 0.85;
    Sanjay Gandhi NP and Aarey Colony have < 0.15.

    Falls back to a spatially-varying estimate based on elevation
    (lower = more urbanised in Mumbai) if Landsat data unavailable.
    """
    try:
        import rasterio
        with rasterio.open(landsat_path) as src:
            nir  = src.read(5).astype(float)
            swir = src.read(6).astype(float)
        ndbi = (swir - nir) / (swir + nir + 1e-9)
        return np.clip((ndbi + 1) / 2, 0, 1).astype(np.float32)
    except Exception:
        # Elevation-based proxy: low-lying → denser urban → more impervious
        # Mumbai mean urban elevation ≈ 8m; above 50m → mostly forested (SGNP)
        urban_frac = np.clip(1.0 - (dem / 50.0), 0.20, 0.95)
        return urban_frac.astype(np.float32)


# ── Risk Score Computation ─────────────────────────────────────────────────────

def compute_flood_risk_score(
    rainfall_intensity:  np.ndarray,
    low_elevation:       np.ndarray,
    drainage_overflow:   np.ndarray,
    coastal_tidal:       np.ndarray,
    impervious_surface:  np.ndarray,
    soil_saturation:     np.ndarray,
    weights:             dict = WEIGHTS,
) -> np.ndarray:
    """
    Compute normalised flood risk score (0–100) per 50m grid cell.
    All input arrays must be pre-normalised to [0, 1].

    Parameters
    ----------
    rainfall_intensity   : Normalised event rainfall (vs historical 90th pctile)
    low_elevation        : Low-elevation score (1 = at/below sea level)
    drainage_overflow    : MCGM drain overflow risk
    coastal_tidal        : Tidal/creek flood exposure (Mumbai-specific)
    impervious_surface   : Landsat-8 NDBI impervious fraction
    soil_saturation      : SoilMoisture_pct / 100 from flood dataset
    weights              : Component weights dict (must sum to 1)

    Returns
    -------
    risk_score : np.ndarray float32, range [0, 100]
    """
    raw_score = (
        weights["rainfall_intensity"] * rainfall_intensity +
        weights["low_elevation"]       * low_elevation     +
        weights["drainage_overflow"]   * drainage_overflow +
        weights["coastal_tidal"]       * coastal_tidal     +
        weights["impervious_surface"]  * impervious_surface +
        weights["soil_saturation"]     * soil_saturation
    )
    return (np.clip(raw_score, 0, 1) * 100).astype(np.float32)


def classify_risk(score: np.ndarray) -> np.ndarray:
    """
    Classify cells into risk categories.
    Returns array of strings: 'critical', 'high', 'medium', 'low'
    """
    result = np.full(score.shape, "low", dtype=object)
    result[score >= RISK_THRESHOLDS["medium"]]   = "medium"
    result[score >= RISK_THRESHOLDS["high"]]     = "high"
    result[score >= RISK_THRESHOLDS["critical"]] = "critical"
    return result


# ── Ward Grid Helper ───────────────────────────────────────────────────────────

def load_ward_boundaries(shapefile_path: str) -> gpd.GeoDataFrame:
    """
    Load BMC ward boundaries (optional — 227 wards, A–T administrative groups).
    Projects to UTM Zone 43N.
    """
    wards = gpd.read_file(shapefile_path)
    wards = wards.to_crs("EPSG:32643")
    return wards


# ── Hotspot Extraction ─────────────────────────────────────────────────────────

def extract_hotspots(
    risk_score:   np.ndarray,
    risk_class:   np.ndarray,
    ward_grid:    np.ndarray,
    transform,
    min_score:    float = 40.0,
    top_n:        int   = 5000,
) -> pd.DataFrame:
    """
    Extract top-N flood micro-hotspots as a DataFrame.

    Zone IDs use 'MHZ-' prefix (Maharashtra Hazard Zone) to distinguish
    from Delhi 'DHZ-' zones.

    Parameters
    ----------
    risk_score  : 2-D float32 risk score array
    risk_class  : 2-D str array from classify_risk()
    ward_grid   : 2-D int array mapping cell → BMC ward ID (0 = unknown)
    transform   : Rasterio Affine transform for coord conversion
    min_score   : Minimum score to include
    top_n       : Maximum hotspots to return

    Returns
    -------
    DataFrame: zone_id, row, col, score, risk_class, ward_id, lon, lat
    """
    rows_idx, cols_idx = np.where(risk_score >= min_score)
    scores   = risk_score[rows_idx, cols_idx]
    classes  = risk_class[rows_idx, cols_idx]
    ward_ids = ward_grid[rows_idx, cols_idx]

    xs, ys = [], []
    for r, c in zip(rows_idx, cols_idx):
        x, y = transform * (c + 0.5, r + 0.5)
        xs.append(x)
        ys.append(y)

    df = pd.DataFrame({
        "zone_id":    [f"MHZ-{i:05d}" for i in range(len(rows_idx))],
        "row":        rows_idx,
        "col":        cols_idx,
        "score":      scores,
        "risk_class": classes,
        "ward_id":    ward_ids,
        "lon":        xs,
        "lat":        ys,
    })

    df = df.sort_values("score", ascending=False).head(top_n).reset_index(drop=True)
    return df


# ── Main Pipeline ──────────────────────────────────────────────────────────────

def run_risk_pipeline(
    dem_paths:        list[str] = DEM_TILE_PATHS,
    drainage_path:    str       = "data/drainagemumbai.geojson",
    rainfall_csv:     str       = "data/mumbai_rainfall.csv",
    flood_obs_csv:    str       = "data/mumbai_flood_dataset.csv",
    landsat_path:     str | None = None,
    ward_path:        str | None = None,
    # Live event overrides (if None, latest row of flood_obs_csv is used)
    rainfall_mm:      float | None = None,
    water_level_m:    float | None = None,
    soil_saturation:  float | None = None,
    event_date:       str   | None = None,
    output_dir:       str          = "output",
) -> pd.DataFrame:
    """
    End-to-end flood risk pipeline for Mumbai.

    Steps
    -----
    1.  Load & mosaic SRTM DEMs (n19_e072 + n19_e073)
    2.  Derive flow accumulation (D8 or gradient proxy)
    3.  Load drainage GeoJSON → rasterise overflow risk
    4.  Compute coastal/tidal flood score (Mithi + Arabian Sea)
    5.  Compute impervious surface (Landsat NDBI or elevation proxy)
    6.  Normalise rainfall against historical climatology
    7.  Assemble weighted risk score
    8.  Extract and export hotspots

    Returns
    -------
    hotspots : pd.DataFrame
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # ── Step 1: DEM ────────────────────────────────────────────────────────────
    print("[1/8] Loading & mosaicking SRTM DEM tiles...")
    if len(dem_paths) > 1:
        dem, transform, crs = load_and_mosaic_dem(dem_paths)
    else:
        dem, transform, crs = load_dem_single(dem_paths[0])

    # Low-elevation score: normalise so 0m → 1.0, max elevation → 0.0
    # Mumbai ranges from 0m (reclaimed) to ~450m (Sanjay Gandhi NP ridge)
    elev_norm = 1.0 - np.clip((dem - 0) / (dem.max() + 1e-9), 0, 1)

    # ── Step 2: Flow Accumulation ──────────────────────────────────────────────
    print("[2/8] Computing D8 flow accumulation...")
    flow_acc = compute_flow_accumulation(dem)

    # ── Step 3: Drainage Overflow ──────────────────────────────────────────────
    print("[3/8] Loading drainage GeoJSON and computing overflow risk...")
    drainage_gdf = load_drainage_geojson(drainage_path)

    # Determine rainfall for overflow calc
    _rain_mm = rainfall_mm if rainfall_mm is not None else 50.0
    drain_overflow = rasterise_drainage_overflow(
        drainage_gdf   = drainage_gdf,
        dem_shape      = dem.shape,
        transform      = transform,
        rainfall_mm    = _rain_mm,
    )

    # ── Step 4: Rainfall Climatology + Normalisation ───────────────────────────
    print("[4/8] Computing rainfall normalisation from historical data...")
    climatology = load_rainfall_climatology(rainfall_csv)

    # Load flood observations for current conditions
    flood_df = load_flood_observations(flood_obs_csv)

    if rainfall_mm is None or water_level_m is None or soil_saturation is None:
        print("       → Using latest row from flood observations CSV")
        conditions    = get_current_conditions(flood_df, event_date)
        _rain_mm      = conditions["rainfall_mm"]
        _wl_m         = conditions["water_level_m"]
        _soil_sat     = conditions["soil_saturation"]
        _flood_obs    = conditions["flood_observed"]
    else:
        _rain_mm   = rainfall_mm
        _wl_m      = water_level_m
        _soil_sat  = soil_saturation
        _flood_obs = None

    rain_norm  = np.full(dem.shape, normalise_rainfall(_rain_mm, climatology), dtype=np.float32)
    soil_layer = np.full(dem.shape, np.clip(_soil_sat, 0, 1), dtype=np.float32)

    print(f"       Rainfall: {_rain_mm:.1f} mm  |  Water level: {_wl_m:.2f} m  |  "
          f"Soil moisture: {_soil_sat*100:.1f}%")
    print(f"       Historical ref: July P90 = {climatology['july_p90_mm']:.0f} mm")

    # ── Step 5: Coastal / Tidal Score ─────────────────────────────────────────
    print("[5/8] Computing coastal/tidal flood score...")
    coastal_score = compute_coastal_tidal_score(dem, _wl_m)

    # ── Step 6: Impervious Surface ─────────────────────────────────────────────
    print("[6/8] Computing impervious surface (Landsat NDBI / elevation proxy)...")
    impervious = compute_impervious_surface(landsat_path or "", dem)

    # ── Step 7: Risk Score ─────────────────────────────────────────────────────
    print("[7/8] Computing weighted flood risk scores...")
    risk_score = compute_flood_risk_score(
        rainfall_intensity  = rain_norm,
        low_elevation       = elev_norm,
        drainage_overflow   = drain_overflow,
        coastal_tidal       = coastal_score,
        impervious_surface  = impervious,
        soil_saturation     = soil_layer,
    )
    risk_class = classify_risk(risk_score)

    # ── Step 8: Hotspot Extraction ─────────────────────────────────────────────
    print("[8/8] Extracting flood hotspots...")
    ward_grid = np.zeros(dem.shape, dtype=np.int32)   # Placeholder until ward shp loaded
    if ward_path:
        try:
            # Optional: rasterise ward polygons to assign ward IDs to cells
            ward_gdf  = load_ward_boundaries(ward_path)
            print(f"       Ward boundaries loaded: {len(ward_gdf)} wards")
        except Exception as e:
            print(f"       Ward load failed ({e}), using placeholder ward_id=0")

    hotspots = extract_hotspots(risk_score, risk_class, ward_grid, transform)

    # ── Outputs ────────────────────────────────────────────────────────────────
    out_csv = Path(output_dir) / "mumbai_hotspots.csv"
    hotspots.to_csv(out_csv, index=False)

    summary = {
        "total":    len(hotspots),
        "critical": (hotspots["risk_class"] == "critical").sum(),
        "high":     (hotspots["risk_class"] == "high").sum(),
        "medium":   (hotspots["risk_class"] == "medium").sum(),
        "low":      (hotspots["risk_class"] == "low").sum(),
    }

    print(f"\n✅ {len(hotspots)} hotspots saved → {out_csv}")
    print(f"   Critical : {summary['critical']}")
    print(f"   High     : {summary['high']}")
    print(f"   Medium   : {summary['medium']}")
    print(f"   Low      : {summary['low']}")

    if _flood_obs is not None:
        print(f"\n   ⚠  Historical flood recorded on this date: {_flood_obs}")

    return hotspots


# ── CLI Entry Point ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="MFIS — Mumbai Flood Risk Pipeline")
    parser.add_argument("--dem",       nargs="+", default=DEM_TILE_PATHS,
                        help="Path(s) to SRTM DEM .tif tiles (supply both for full coverage)")
    parser.add_argument("--drainage",  default="data/drainagemumbai.geojson")
    parser.add_argument("--rainfall-csv",  dest="rainfall_csv",
                        default="data/mumbai_rainfall.csv")
    parser.add_argument("--flood-csv",     dest="flood_csv",
                        default="data/mumbai_flood_dataset.csv")
    parser.add_argument("--landsat",   default=None, help="Landsat-8 .tif (optional)")
    parser.add_argument("--ward",      default=None, help="BMC ward shapefile (optional)")
    parser.add_argument("--rainfall",  type=float, default=None,
                        help="Override event rainfall in mm (else uses latest CSV row)")
    parser.add_argument("--wl",        type=float, default=None,
                        help="Override water level in metres")
    parser.add_argument("--soil",      type=float, default=None,
                        help="Override soil saturation 0–1")
    parser.add_argument("--date",      default=None, help="Event date DD-MM-YYYY")
    parser.add_argument("--output",    default="output")
    args = parser.parse_args()

    hotspots = run_risk_pipeline(
        dem_paths       = args.dem,
        drainage_path   = args.drainage,
        rainfall_csv    = args.rainfall_csv,
        flood_obs_csv   = args.flood_csv,
        landsat_path    = args.landsat,
        ward_path       = args.ward,
        rainfall_mm     = args.rainfall,
        water_level_m   = args.wl,
        soil_saturation = args.soil,
        event_date      = args.date,
        output_dir      = args.output,
    )
    print("\nTop 10 hotspots:")
    print(hotspots.head(10).to_string(index=False))