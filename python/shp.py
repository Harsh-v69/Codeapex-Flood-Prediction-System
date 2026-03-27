"""
Convert OSM drain GeoJSON → delhi_jal_board_drains.shp
Place this script in your dfis/ folder and run it.
"""

import os
import sys

# Auto-find the GeoJSON file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.normpath(os.path.join(BASE_DIR, '..', 'data'))

# Search for the downloaded GeoJSON
candidates = [
    os.path.join(DATA_DIR, 'export.geojson'),
    os.path.join(DATA_DIR, 'delhi_jal_board_drains.geojson'),
    os.path.join(DATA_DIR, 'overpass.geojson'),
    os.path.join(DATA_DIR, 'map.geojson'),
]

geojson_path = None
for c in candidates:
    if os.path.exists(c):
        geojson_path = c
        break

# Also check current directory
if geojson_path is None:
    for fname in os.listdir(DATA_DIR):
        if fname.endswith('.geojson'):
            geojson_path = os.path.join(DATA_DIR, fname)
            break

if geojson_path is None:
    print("❌ No GeoJSON file found in data/ folder.")
    print("   Make sure you exported from overpass-turbo.eu")
    print("   and saved the file into your dfis/data/ folder.")
    sys.exit(1)

print(f"Found: {geojson_path}")

try:
    import geopandas as gpd
except ImportError:
    print("Installing geopandas...")
    os.system("pip install geopandas fiona pyproj shapely")
    import geopandas as gpd

# Read and convert
print("Reading GeoJSON...")
gdf = gpd.read_file(geojson_path)
print(f"  Features loaded : {len(gdf)}")
print(f"  Geometry types  : {gdf.geom_type.value_counts().to_dict()}")
print(f"  CRS             : {gdf.crs}")

# Ensure CRS is WGS84
if gdf.crs is None:
    gdf = gdf.set_crs('EPSG:4326')
elif gdf.crs.to_epsg() != 4326:
    gdf = gdf.to_crs('EPSG:4326')

# Keep only relevant columns
keep_cols = ['geometry']
for col in ['name', 'waterway', 'width', 'depth', 'covered', 'tunnel']:
    if col in gdf.columns:
        keep_cols.append(col)

gdf = gdf[keep_cols]

# Save as SHP
out_path = os.path.join(DATA_DIR, 'delhi_jal_board_drains.shp')
gdf.to_file(out_path)

print(f"\n✅ Saved: {out_path}")
print(f"   Features : {len(gdf)}")
print(f"\nAll 4 datasets are now ready:")
print(f"  ✅ delhi_historical_floods.csv")
print(f"  ✅ delhi_srtm_30m.tif")
print(f"  ✅ Delhi_Wards.shp")
print(f"  ✅ delhi_jal_board_drains.shp")
print(f"\n✅ Next step: python ml_model.py")