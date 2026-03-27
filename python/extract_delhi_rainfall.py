"""
DFIS — Delhi Flood Intelligence System
IMD NetCDF → delhi_historical_floods.csv

This script reads all RF25_ind*.nc files from your data/ folder,
extracts the Delhi grid cell, and builds a training-ready CSV.

Usage:
    pip install netCDF4 numpy pandas scipy
    python extract_delhi_rainfall.py

Output:
    data/delhi_historical_floods.csv  ← ready for ml_model.py training
"""

import os
import glob
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path

try:
    import netCDF4 as nc
except ImportError:
    print("Installing netCDF4...")
    os.system("pip install netCDF4 numpy pandas scipy")
    import netCDF4 as nc

# ─────────────────────────────────────────────
# CONFIG — searches multiple candidate folders
# ─────────────────────────────────────────────
_script_dir = Path(__file__).resolve().parent
_project_dir = _script_dir.parent

_candidates = [
    _script_dir,
    _script_dir / "data",
    _project_dir / "data",
    _project_dir.parent / "data",
]

DATA_DIR = None
for _c in _candidates:
    _c = Path(_c).resolve()
    if glob.glob(str(_c / "RF25_ind*.nc")):
        DATA_DIR = str(_c)
        print(f"Found .nc files in: {_c}")
        break

if DATA_DIR is None:
    DATA_DIR = str((_project_dir / "data").resolve())
    print(f"Using project data path: {DATA_DIR}")

OUTPUT_CSV = os.path.join(DATA_DIR, "delhi_historical_floods.csv")

# Delhi NCT grid cells (0.25° grid)
# IMD grid: lat 6.5–38.5N, lon 66.5–100.0E, step 0.25°
# Delhi centroid ≈ 28.6°N, 77.2°E → nearest grid points:
DELHI_LATS = [28.50, 28.75]   # two lat bands covering Delhi NCT
DELHI_LONS = [77.00, 77.25]   # two lon bands covering Delhi NCT

# Known major Delhi flood event dates (used for labelling)
# Source: NDMA, CWC, media records
KNOWN_FLOOD_EVENTS = {
    # (year, month, day): yamuna_level_m (0 if not recorded)
    (2008, 9, 9):  207.49,
    (2008, 9, 10): 207.11,
    (2010, 8, 17): 205.80,
    (2010, 9, 20): 205.10,
    (2011, 8, 14): 204.90,
    (2012, 8, 16): 205.20,
    (2013, 6, 17): 205.60,
    (2013, 8, 19): 204.80,
    (2015, 8, 25): 204.50,
    (2016, 8, 28): 205.10,
    (2017, 8, 9):  205.30,
    (2018, 8, 19): 205.76,
    (2018, 8, 20): 205.95,
    (2019, 8, 17): 205.82,
    (2019, 8, 18): 206.60,
    (2020, 8, 18): 205.81,
    (2020, 9, 1):  205.72,
    (2021, 7, 25): 206.02,
    (2021, 8, 2):  205.50,
    (2022, 8, 13): 205.21,
    (2023, 7, 11): 207.55,
    (2023, 7, 12): 208.48,   # highest in 45 years
    (2023, 7, 13): 208.66,
    (2023, 8, 14): 206.80,
    (2024, 6, 28): 205.90,
    (2024, 7, 15): 206.10,
}

# ─────────────────────────────────────────────
# FLOOD THRESHOLDS
# ─────────────────────────────────────────────
# IMD defines "heavy rain" as > 64.5 mm/day
# "very heavy" as > 115.5 mm/day
# For urban flood labelling we use a conservative 40mm/day
FLOOD_RAIN_THRESHOLD_MM  = 40.0   # daily rainfall → flood risk
SEVERE_RAIN_THRESHOLD_MM = 100.0  # severe flood risk

# Monsoon months (Jun–Sep) are flood season
MONSOON_MONTHS = [6, 7, 8, 9]


def find_grid_indices(lat_arr, lon_arr):
    """Find IMD grid indices nearest to Delhi lat/lon pairs."""
    indices = []
    for dlat in DELHI_LATS:
        for dlon in DELHI_LONS:
            lat_idx = np.argmin(np.abs(lat_arr - dlat))
            lon_idx = np.argmin(np.abs(lon_arr - dlon))
            indices.append((lat_idx, lon_idx, dlat, dlon))
    return indices


def extract_year(filepath):
    """Extract year from filename like RF25_ind2008_rfp25.nc"""
    basename = os.path.basename(filepath)
    for part in basename.split('_'):
        if part.startswith('ind') and len(part) == 7:
            try:
                return int(part[3:])
            except ValueError:
                pass
    # fallback: find 4-digit number
    import re
    match = re.search(r'(\d{4})', basename)
    return int(match.group(1)) if match else None


def process_nc_file(filepath):
    """Read one NetCDF file and return DataFrame of Delhi daily rainfall."""
    year = extract_year(filepath)
    if year is None:
        print(f"  ⚠ Could not determine year from {filepath}, skipping.")
        return None

    print(f"  Processing year {year}...", end=" ")

    try:
        ds = nc.Dataset(filepath, 'r')
    except Exception as e:
        print(f"ERROR: {e}")
        return None

    # Variable names vary — try common ones
    rain_var = None
    for vname in ['RAINFALL', 'rainfall', 'rf', 'RF', 'rain', 'precip']:
        if vname in ds.variables:
            rain_var = vname
            break

    lat_var = None
    for vname in ['LATITUDE', 'latitude', 'lat', 'LAT']:
        if vname in ds.variables:
            lat_var = vname
            break

    lon_var = None
    for vname in ['LONGITUDE', 'longitude', 'lon', 'LON']:
        if vname in ds.variables:
            lon_var = vname
            break

    if rain_var is None:
        print(f"  ⚠ No rainfall variable found. Variables: {list(ds.variables.keys())}")
        ds.close()
        return None

    lat_arr = ds.variables[lat_var][:]
    lon_arr = ds.variables[lon_var][:]
    rain    = ds.variables[rain_var][:]  # shape: (days, lat, lon)

    # Replace fill values / masked values
    if hasattr(rain, 'mask'):
        rain = rain.filled(np.nan)

    # Replace IMD fill value (-999.0 or 99.9)
    rain = np.where((rain < 0) | (rain > 500), np.nan, rain)

    grid_indices = find_grid_indices(lat_arr, lon_arr)

    rows = []
    n_days = rain.shape[0]

    for day_idx in range(n_days):
        date = datetime(year, 1, 1) + timedelta(days=day_idx)

        # Average rainfall across Delhi grid cells
        cell_vals = []
        for (li, loi, dlat, dlon) in grid_indices:
            val = rain[day_idx, li, loi]
            if not np.isnan(val):
                cell_vals.append(val)

        if len(cell_vals) == 0:
            continue

        delhi_rainfall = float(np.mean(cell_vals))
        delhi_max      = float(np.max(cell_vals))

        # Determine flood label
        event_key = (date.year, date.month, date.day)
        yamuna_level = KNOWN_FLOOD_EVENTS.get(event_key, 0.0)
        flood_occurred = 1 if event_key in KNOWN_FLOOD_EVENTS else 0

        # Also label high-rainfall days during monsoon as potential floods
        if flood_occurred == 0 and date.month in MONSOON_MONTHS:
            if delhi_rainfall >= SEVERE_RAIN_THRESHOLD_MM:
                flood_occurred = 1   # very heavy rain → flood
                yamuna_level = 205.5  # estimated

        # Features
        rows.append({
            'date':            date.strftime('%Y-%m-%d'),
            'year':            date.year,
            'month':           date.month,
            'day':             date.day,
            'day_of_year':     date.timetuple().tm_yday,
            'is_monsoon':      1 if date.month in MONSOON_MONTHS else 0,
            'rainfall_mm':     round(delhi_rainfall, 2),
            'rainfall_max_mm': round(delhi_max, 2),
            'yamuna_level_m':  yamuna_level,
            'flood_occurred':  flood_occurred,
        })

    ds.close()
    print(f"  {n_days} days → {sum(r['flood_occurred'] for r in rows)} flood days")
    return pd.DataFrame(rows)


def add_engineered_features(df):
    """Add rolling features that ml_model.py expects."""
    print("\nEngineering features...")
    df = df.sort_values('date').reset_index(drop=True)

    # Rolling antecedent rainfall
    df['rainfall_3day']  = df['rainfall_mm'].rolling(3,  min_periods=1).sum()
    df['rainfall_7day']  = df['rainfall_mm'].rolling(7,  min_periods=1).sum()
    df['rainfall_15day'] = df['rainfall_mm'].rolling(15, min_periods=1).sum()

    # Rainfall intensity proxy (daily mm = intensity for 0.25° grid)
    df['rainfall_intensity'] = df['rainfall_mm']

    # Monsoon day (day within monsoon season, 0 outside)
    df['monsoon_day'] = 0
    for idx, row in df.iterrows():
        if row['is_monsoon']:
            yr_monsoon = df[(df['year'] == row['year']) & (df['is_monsoon'] == 1)]
            df.at[idx, 'monsoon_day'] = int((df.at[idx, 'date'] > yr_monsoon['date'].min())) + 1

    # Soil saturation proxy (cumulative monsoon rainfall resets each year)
    df['soil_saturation'] = 0.0
    for year in df['year'].unique():
        mask = (df['year'] == year) & (df['is_monsoon'] == 1)
        cum  = df.loc[mask, 'rainfall_mm'].cumsum()
        # Normalize 0–100
        if cum.max() > 0:
            df.loc[mask, 'soil_saturation'] = (cum / cum.max() * 100).round(1)

    # Static Delhi features (same for all rows — spatial average)
    df['elevation_m']        = 212.0   # Delhi average SRTM elevation
    df['slope_deg']          = 0.3     # very flat terrain
    df['flow_accumulation']  = 850.0   # D8 flow accumulation proxy
    df['drain_capacity_pct'] = 62.0    # average DJB drain capacity
    df['impervious_pct']     = 71.0    # % impervious surface (Landsat)
    df['drain_blockage_idx'] = 0.38    # 0–1 blockage index
    df['yamuna_proximity_m'] = 2100.0  # avg distance from Yamuna (m)

    # Yamuna discharge proxy from level (empirical: 205.33m ≈ 8500 m³/s)
    df['yamuna_discharge'] = df['yamuna_level_m'].apply(
        lambda lvl: max(0, (lvl - 200.0) * 1350) if lvl > 0 else 2000.0
    )

    # Yamuna level change (hour-over-hour proxy, daily here)
    df['yamuna_level_change'] = df['yamuna_level_m'].diff().fillna(0).round(3)

    print(f"  Features added. Total columns: {len(df.columns)}")
    return df


def main():
    print("=" * 60)
    print("DFIS — IMD NetCDF → delhi_historical_floods.csv")
    print("=" * 60)

    # Find all NetCDF files
    pattern = os.path.join(DATA_DIR, "RF25_ind*.nc")
    files   = sorted(glob.glob(pattern))

    if not files:
        # Also try current directory
        files = sorted(glob.glob("RF25_ind*.nc"))
        if files:
            DATA_DIR_USE = "."
        else:
            print(f"\n❌ No NetCDF files found in: {DATA_DIR}")
            print(f"   Make sure your .nc files are in the data/ folder.")
            return
    else:
        DATA_DIR_USE = DATA_DIR

    print(f"\nFound {len(files)} NetCDF files:")
    for f in files:
        print(f"  {os.path.basename(f)}")

    print(f"\nExtracting Delhi grid (28.50–28.75°N, 77.00–77.25°E)...")
    print("-" * 60)

    all_dfs = []
    for filepath in files:
        df_year = process_nc_file(filepath)
        if df_year is not None and len(df_year) > 0:
            all_dfs.append(df_year)

    if not all_dfs:
        print("\n❌ No data extracted. Check your NetCDF files.")
        return

    # Combine all years
    df = pd.concat(all_dfs, ignore_index=True)
    df = df.sort_values('date').reset_index(drop=True)

    # Remove duplicate 2012 file if present
    df = df.drop_duplicates(subset=['date'])

    print(f"\nCombined: {len(df)} total days ({df['year'].min()}–{df['year'].max()})")
    print(f"Flood days: {df['flood_occurred'].sum()} ({df['flood_occurred'].mean()*100:.1f}%)")

    # Engineer features
    df = add_engineered_features(df)

    # Final column order (matches ml_model.py)
    col_order = [
        'date', 'year', 'month', 'day', 'day_of_year',
        'is_monsoon', 'monsoon_day',
        'rainfall_mm', 'rainfall_max_mm',
        'rainfall_intensity', 'rainfall_3day', 'rainfall_7day', 'rainfall_15day',
        'soil_saturation',
        'yamuna_level_m', 'yamuna_level_change', 'yamuna_discharge',
        'elevation_m', 'slope_deg', 'flow_accumulation',
        'drain_capacity_pct', 'impervious_pct', 'drain_blockage_idx',
        'yamuna_proximity_m',
        'flood_occurred',
    ]
    df = df[col_order]

    # Save
    os.makedirs(os.path.dirname(OUTPUT_CSV) if os.path.dirname(OUTPUT_CSV) else '.', exist_ok=True)
    df.to_csv(OUTPUT_CSV, index=False)

    print(f"\n{'='*60}")
    print(f"✅ Saved: {OUTPUT_CSV}")
    print(f"   Rows    : {len(df):,}")
    print(f"   Columns : {len(df.columns)}")
    print(f"   Years   : {df['year'].min()} – {df['year'].max()}")
    print(f"   Flood days: {df['flood_occurred'].sum()} ({df['flood_occurred'].mean()*100:.1f}%)")
    print(f"\nFlood days by year:")
    flood_by_year = df.groupby('year')['flood_occurred'].sum()
    for yr, cnt in flood_by_year.items():
        bar = '█' * int(cnt / 2)
        print(f"  {yr}: {bar} {cnt}")
    print(f"\n✅ Next step: python ml_model.py")
    print(f"   This will train XGBoost + LSTM on this data.")
    print("=" * 60)


if __name__ == '__main__':
    main()
