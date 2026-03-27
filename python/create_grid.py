import numpy as np
import pandas as pd

# Delhi bounds
lat_min, lat_max = 28.4, 28.9
lon_min, lon_max = 77.0, 77.4

# 50m grid = ~2,800 cells in Delhi
grid_size_m = 50
earth_radius_km = 6371

cells = []
for lat in np.arange(lat_min, lat_max, 0.01):  # ~1 km steps
    for lon in np.arange(lon_min, lon_max, 0.01):
        cells.append({
            'cell_id': f'C-{len(cells):06d}',
            'lat': lat,
            'lon': lon,
            'elevation_m': 205 + np.random.normal(0, 3),  # Estimate
            'slope_deg': 0.5 + np.random.normal(0, 0.2),
            'flow_accumulation': 100 + np.random.exponential(50),
            'drain_capacity_pct': 60 + np.random.normal(0, 15),
            'impervious_pct': 70 + np.random.normal(0, 10),
        })

df_cells = pd.DataFrame(cells)
df_cells.to_csv('delhi_grid_2800_cells.csv', index=False)
print(f"Created {len(cells)} cells")
