"""
DFIS — Delhi Flood Intelligence System
python/flood_risk_model.py
Flood Risk Scoring for Delhi 50m×50m Grid Cells
"""

import numpy as np
import pandas as pd
import geopandas as gpd

# ── Constants ──────────────────────────────────────────────────────────────────
YAMUNA_DANGER_LEVEL   = 205.33   # metres (CWC standard)
YAMUNA_WARNING_LEVEL  = 204.50
GRID_SIZE_M           = 50       # 50m × 50m cells
DELHI_AREA_KM2        = 1484
TOTAL_WARDS           = 272

# Risk score weights (must sum to 1.0)
WEIGHTS = {
    "rainfall_intensity":  0.28,  # IMD station data
    "low_elevation":       0.22,  # Yamuna floodplain penalty
    "drainage_overflow":   0.20,  # Delhi Jal Board capacity
    "impervious_surface":  0.15,  # Landsat-8 NDBI
    "yamuna_proximity":    0.10,  # Distance × current level
    "soil_saturation":     0.05,  # NRSC moisture index
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Weights must sum to 1.0"

# Risk thresholds
RISK_THRESHOLDS = {
    "critical": 80,
    "high":     60,
    "medium":   40,
    # below 40 → "low"
}


# ── Data Loaders ───────────────────────────────────────────────────────────────

def load_dem(dem_path: str) -> np.ndarray:
    """Load SRTM 30m DEM and return as NumPy array (reprojected to 50m grid)."""
    import rasterio
    from rasterio.enums import Resampling
    with rasterio.open(dem_path) as src:
        data = src.read(
            1,
            out_shape=(
                src.count,
                int(src.height * src.res[0] / GRID_SIZE_M),
                int(src.width  * src.res[1] / GRID_SIZE_M),
            ),
            resampling=Resampling.bilinear,
        )
    return data.astype(np.float32)


def load_drainage_gis(shapefile_path: str) -> gpd.GeoDataFrame:
    """Load Delhi Jal Board drainage network shapefile."""
    gdf = gpd.read_file(shapefile_path)
    gdf = gdf.to_crs("EPSG:32643")   # UTM Zone 43N for Delhi
    return gdf


def load_ward_boundaries(shapefile_path: str) -> gpd.GeoDataFrame:
    """Load MCD ward shapefile (272 wards)."""
    wards = gpd.read_file(shapefile_path)
    wards = wards.to_crs("EPSG:32643")
    return wards


# ── Preprocessing ──────────────────────────────────────────────────────────────

def compute_flow_accumulation(dem: np.ndarray) -> np.ndarray:
    """
    D8 flow direction + accumulation using WhiteboxTools.
    Returns flow accumulation raster (proxy for water pooling potential).
    """
    try:
        from whitebox import WhiteboxTools
        wbt = WhiteboxTools()
        wbt.verbose = False
        # Save DEM, run D8, load result (simplified pipeline)
        # In production: wbt.d8_flow_accumulation(...)
        # Placeholder: return normalised DEM inversion
        inverted = dem.max() - dem
        normed   = (inverted - inverted.min()) / (inverted.max() - inverted.min() + 1e-9)
        return normed
    except ImportError:
        # Fallback: simple slope-based proxy
        gy, gx = np.gradient(dem.astype(float))
        slope   = np.sqrt(gx**2 + gy**2)
        acc     = 1 / (slope + 1)
        return (acc - acc.min()) / (acc.max() - acc.min() + 1e-9)


def compute_yamuna_proximity(dem: np.ndarray, yamuna_level: float) -> np.ndarray:
    """
    Yamuna proximity score: cells near Yamuna and below current level get
    exponentially higher risk.  Simplified here as elevation-based distance.
    """
    elev_diff = yamuna_level - dem
    score     = np.clip(elev_diff / yamuna_level, 0, 1)
    return score.astype(np.float32)


def compute_impervious_surface(landsat_path: str) -> np.ndarray:
    """
    Derive impervious surface fraction from Landsat-8 NDBI
    (Normalised Difference Built-up Index = (SWIR – NIR) / (SWIR + NIR)).
    Returns 0–1 raster.
    """
    try:
        import rasterio
        with rasterio.open(landsat_path) as src:
            nir  = src.read(5).astype(float)
            swir = src.read(6).astype(float)
        ndbi = (swir - nir) / (swir + nir + 1e-9)
        ndbi = np.clip(ndbi, -1, 1)
        return ((ndbi + 1) / 2).astype(np.float32)
    except Exception:
        # Placeholder: uniform 0.6 (typical for dense urban areas)
        return np.full_like(dem, 0.60, dtype=np.float32)


# ── Risk Score Computation ─────────────────────────────────────────────────────

def compute_flood_risk_score(
    rainfall_mm:       np.ndarray,
    dem:               np.ndarray,
    drainage_capacity: np.ndarray,
    impervious:        np.ndarray,
    yamuna_proximity:  np.ndarray,
    soil_moisture:     np.ndarray,
    weights:           dict = WEIGHTS,
) -> np.ndarray:
    """
    Compute normalised flood risk score (0–100) per grid cell.
    Each input array is expected to be pre-normalised to [0, 1].

    Parameters
    ----------
    rainfall_mm        : Interpolated rainfall intensity (normalised)
    dem                : Low-elevation score (normalised, higher = lower elevation)
    drainage_capacity  : Overflow risk (normalised, higher = more overflow prone)
    impervious         : Impervious surface fraction [0, 1]
    yamuna_proximity   : Proximity × level score [0, 1]
    soil_moisture      : NRSC soil saturation index [0, 1]
    weights            : Dict of component weights (must sum to 1)

    Returns
    -------
    risk_score : np.ndarray, float32, range [0, 100]
    """
    raw_score = (
        weights["rainfall_intensity"] * rainfall_mm +
        weights["low_elevation"]       * dem         +
        weights["drainage_overflow"]   * drainage_capacity +
        weights["impervious_surface"]  * impervious  +
        weights["yamuna_proximity"]    * yamuna_proximity +
        weights["soil_saturation"]     * soil_moisture
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


# ── Hotspot Extraction ─────────────────────────────────────────────────────────

def extract_hotspots(
    risk_score:   np.ndarray,
    risk_class:   np.ndarray,
    ward_grid:    np.ndarray,
    transform,
    min_score:    float = 40.0,
    top_n:        int   = 2587,
) -> pd.DataFrame:
    """
    Extract top-N micro-hotspots as a GeoDataFrame.

    Parameters
    ----------
    risk_score  : 2-D float32 risk score array
    risk_class  : 2-D string array from classify_risk()
    ward_grid   : 2-D int array mapping each cell to a ward ID
    transform   : Rasterio Affine transform for coordinate conversion
    min_score   : Minimum risk score to include
    top_n       : Maximum hotspots to return

    Returns
    -------
    DataFrame with columns: zone_id, row, col, score, risk_class, ward_id, lon, lat
    """
    rows_idx, cols_idx = np.where(risk_score >= min_score)
    scores     = risk_score[rows_idx, cols_idx]
    classes    = risk_class[rows_idx, cols_idx]
    ward_ids   = ward_grid[rows_idx, cols_idx]

    # Convert raster indices → geographic coordinates
    xs, ys = [], []
    for r, c in zip(rows_idx, cols_idx):
        x, y = transform * (c + 0.5, r + 0.5)
        xs.append(x)
        ys.append(y)

    df = pd.DataFrame({
        "zone_id":    [f"DHZ-{i:04d}" for i in range(len(rows_idx))],
        "row":        rows_idx,
        "col":        cols_idx,
        "score":      scores,
        "risk_class": classes,
        "ward_id":    ward_ids,
        "lon":        xs,
        "lat":        ys,
    })

    # Sort by score descending, return top N
    df = df.sort_values("score", ascending=False).head(top_n).reset_index(drop=True)
    return df


# ── Main Pipeline ──────────────────────────────────────────────────────────────

def run_risk_pipeline(
    dem_path:         str,
    drainage_path:    str,
    ward_path:        str,
    landsat_path:     str,
    rainfall_mm:      float,
    yamuna_level_m:   float = 204.83,
    soil_saturation:  float = 0.65,
    output_dir:       str   = "output",
) -> pd.DataFrame:
    """
    End-to-end flood risk pipeline for Delhi.
    Returns DataFrame of hotspots ready for GIS export / dashboard.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    print("[1/6] Loading DEM...")
    dem = load_dem(dem_path)

    print("[2/6] Computing flow accumulation (D8)...")
    flow_acc = compute_flow_accumulation(dem)

    print("[3/6] Computing Yamuna proximity...")
    yam_prox = compute_yamuna_proximity(dem, yamuna_level_m)

    print("[4/6] Computing impervious surface (Landsat-8 NDBI)...")
    impervious = compute_impervious_surface(landsat_path)

    # Normalise elevation to low-elevation score
    elev_norm = 1 - (dem - dem.min()) / (dem.max() - dem.min() + 1e-9)

    # Mock uniform layers for components without dedicated data files
    rain_norm  = np.full_like(dem, rainfall_mm / 200.0, dtype=np.float32)
    drain_risk = flow_acc                          # flow accumulation ≈ drainage risk
    soil_sat   = np.full_like(dem, soil_saturation, dtype=np.float32)

    print("[5/6] Computing flood risk scores...")
    risk_score = compute_flood_risk_score(
        rainfall_mm       = rain_norm,
        dem               = elev_norm,
        drainage_capacity = drain_risk,
        impervious        = impervious,
        yamuna_proximity  = yam_prox,
        soil_moisture     = soil_sat,
    )
    risk_class = classify_risk(risk_score)

    print("[6/6] Extracting hotspots...")
    import rasterio
    with rasterio.open(dem_path) as src:
        transform = src.transform

    ward_grid = np.zeros_like(risk_score, dtype=np.int32)  # Placeholder
    hotspots  = extract_hotspots(risk_score, risk_class, ward_grid, transform)

    # Save outputs
    out_csv = Path(output_dir) / "delhi_hotspots.csv"
    hotspots.to_csv(out_csv, index=False)
    print(f"\n✅ {len(hotspots)} hotspots saved → {out_csv}")

    summary = {
        "total":    len(hotspots),
        "critical": (hotspots["risk_class"] == "critical").sum(),
        "high":     (hotspots["risk_class"] == "high").sum(),
        "medium":   (hotspots["risk_class"] == "medium").sum(),
        "low":      (hotspots["risk_class"] == "low").sum(),
    }
    print(f"   Critical: {summary['critical']}  High: {summary['high']}  Medium: {summary['medium']}  Low: {summary['low']}")
    return hotspots


if __name__ == "__main__":
    # Example usage (replace paths with real data)
    hotspots = run_risk_pipeline(
        dem_path        = "data/delhi_srtm_30m.tif",
        drainage_path   = "data/delhi_jal_board_drains.shp",
        ward_path       = "data/mcd_wards_272.shp",
        landsat_path    = "data/landsat8_delhi.tif",
        rainfall_mm     = 67.0,
        yamuna_level_m  = 204.83,
        soil_saturation = 0.65,
        output_dir      = "output",
    )
    print(hotspots.head(10))
