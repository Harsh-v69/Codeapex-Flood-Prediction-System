# Drishti

Multi-city flood prediction, monitoring, readiness, alerting, and routing platform for:

- Delhi
- Mumbai
- Sikkim

Drishti combines a Vanilla JS frontend with a FastAPI backend and city-specific flood logic. The platform is designed around a live operational workflow: watch current conditions, estimate flood risk, inspect hotspots, review readiness, send alerts, run scenarios, and route field response.

## What The Current Version Includes

- Three supported city modes: Delhi, Mumbai, and Sikkim
- One shared frontend with city switching across all major tabs
- Forecast-oriented dashboard focused on the latest risk context
- Flood hotspot mapping with city-aware markers and filters
- Readiness scoring and operational summaries
- Water-level monitoring for the dominant city-relevant water source
- Alerts generation from model and live conditions
- Scenario simulator for all three cities
- Route planning and hotspot-linked navigation
- Floating assistant chat UI backed by `/assistant/chat`

## City Coverage

### Delhi

- Uses the Delhi grid model and the `hotspots_570.json` hotspot catalog
- Uses live weather and flood inputs from Open-Meteo / Flood API
- Water monitoring is Yamuna-oriented

### Mumbai

- Uses dataset-driven Mumbai flood inference
- Uses Mumbai-specific rainfall, hotspot, and terrain assets from `data/mumbai`
- Water context is driven by marine / sea-level signals and Mumbai runtime conditions

### Sikkim

- Uses the integrated SFIS/Sikkim asset set
- Uses Sikkim-specific rasters, shapefiles, NetCDF inputs, model output, and runtime helper logic
- Water monitoring is Teesta-based

## Main User-Facing Modules

- Dashboard
  - consolidated forecast summary
  - hotspot counts by severity
  - rainfall, water level, readiness
  - map, alerts, and top at-risk areas
- Locations
  - hotspot distribution and hotspot table
  - map filters and map legend
- Predictions
  - readiness scoring and readiness table
- Alerts
  - alert severity workflow and dispatch history UI
- Water Monitoring
  - city-relevant water level context and trend
- Route Optimization
  - origin / destination selection and route rationale
- Simulator
  - rainfall, duration, water level, soil, and drainage-driven scenario testing
- Assistant
  - popup chatbot at bottom-right of the UI

## Frontend Stack

- HTML
- CSS
- Vanilla JavaScript
- Leaflet
- Leaflet Routing Machine

The frontend is static and can be opened directly from `index.html`, but the backend must be running for live/model-backed data.

## Backend Stack

- FastAPI
- Uvicorn
- Pydantic
- NumPy
- Pandas
- SciPy
- scikit-learn
- Joblib
- XGBoost

## External Live Data Sources

The latest version uses live APIs for current context where applicable:

- Open-Meteo Forecast API
- Open-Meteo Flood API
- Open-Meteo Marine API

These are used to enrich current and near-term conditions for the selected city.

## Repository Structure

```text
Codeapex-Flood-Prediction-System-main/
|-- index.html
|-- README.md
|-- requirements.txt
|-- start_api.bat
|-- .env.example
|-- delhi_grid_2800_cells.csv
|-- css/
|   |-- base.css
|   |-- components.css
|   |-- layout.css
|   |-- map.css
|   |-- hotspots-page.css
|   |-- wards-page.css
|   `-- yamuna-page.css
|-- js/
|   |-- app.js
|   |-- assistant.js
|   |-- charts.js
|   |-- data.js
|   |-- live.js
|   |-- map.js
|   |-- pages.js
|   |-- route.js
|   |-- send-laert.js
|   |-- simulator.js
|   |-- utils.js
|   `-- wards.js
|-- python/
|   |-- api.py
|   |-- sikkim_runtime.py
|   |-- flood_risk_model.py
|   |-- main.py
|   |-- ml_model.py
|   |-- mumbai_flood_model.py
|   `-- ward_readiness.py
|-- data/
|   |-- hotspots_570.json
|   |-- Delhi_Wards.*
|   |-- delhi_jal_board_drains.*
|   |-- delhi_srtm*.tif
|   |-- mumbai/
|   |   |-- mumbai_flood_dataset.csv
|   |   |-- mumbai_flood_hotspots.json
|   |   |-- mumbai_rainfall.csv
|   |   |-- drainagemumbai.geojson
|   |   `-- *.tif
|   `-- sikkim/
|       |-- sikkim_flood_model.py
|       |-- data/
|       |   |-- Rivers.*
|       |   |-- RF25_ind2001_rfp25.nc
|       |   `-- *.tif
|       `-- output/
|           |-- sikkim_flood_model.pkl
|           `-- sikkim_predictions.csv
|-- docs/
|   `-- screenshots/
`-- models/
    |-- sikkim/
    |   `-- sikkim_flood_model.pkl
    |-- xgboost_flood_model.json
    |-- xgboost_flood_model.pkl
    |-- scaler.pkl
    |-- scaler_params.json
    |-- model_metadata.json
    `-- ...
```

## Installation

### 1. Create a virtual environment

```powershell
python -m venv .venv
```

### 2. Activate it

```powershell
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```powershell
pip install -r requirements.txt
```

## Run The Backend

### Recommended

```powershell
.\start_api.bat
```

`start_api.bat` will:

- switch into `python/`
- use `.venv\Scripts\python.exe` if available
- otherwise fall back to `python`
- start Uvicorn on `127.0.0.1:8000`

### Manual alternative

```powershell
cd .\python
python -m uvicorn api:app --host 127.0.0.1 --port 8000
```

## Run The Frontend

Open:

- `index.html`

You can open it directly in the browser, or use a local static server if you prefer.

The frontend expects the API on:

```text
http://127.0.0.1:8000
```

## Assistant Configuration

The assistant UI is available as a floating popup in the frontend.

If you want model-backed assistant responses, configure environment values through `.env`:

```powershell
Copy-Item .env.example .env
```

Then add your assistant/model key settings as needed.

If the assistant backend route is unavailable, the rest of the flood dashboard still works.

## API Endpoints

Primary backend file:

- `python/api.py`

Current important routes include:

- `GET /`
- `GET /status`
- `GET /predict`
- `GET /hotspots`
- `GET /wards`
- `GET /alerts`
- `GET /yamuna`
- `GET /rainfall`
- `POST /simulate`
- `POST /assistant/chat`

Most city-aware routes support:

- `city=delhi`
- `city=mumbai`
- `city=sikkim`

## Current Backend Behavior

### `/status`

Returns current operational status, city summary, and live/context metadata.

### `/predict`

Returns city-level flood probability and risk classification.

### `/hotspots`

Returns hotspot rows for the selected city, with severity, score, district/ward, and action fields.

### `/wards`

Returns readiness-style operational units or grouped readiness summaries depending on city logic.

### `/alerts`

Returns city-specific alerts derived from current live/model state.

### `/yamuna`

Despite the legacy route name, this endpoint now acts as the water-monitoring endpoint for the active city:

- Delhi: Yamuna context
- Mumbai: Mumbai water / marine context
- Sikkim: Teesta context

### `/rainfall`

Returns rainfall context and forecast-related values for the active city.

### `/simulate`

Runs the simulator logic for the active city.

### `/assistant/chat`

Returns model-backed assistant responses grounded in current city context when configured.

## Data Assets Used By The Current Version

### Delhi assets

- `delhi_grid_2800_cells.csv`
- `data/hotspots_570.json`
- `data/Delhi_Wards.*`
- `data/delhi_jal_board_drains.*`
- Delhi terrain rasters in `data/`

### Mumbai assets

- `data/mumbai/mumbai_flood_dataset.csv`
- `data/mumbai/mumbai_flood_hotspots.json`
- `data/mumbai/mumbai_rainfall.csv`
- `data/mumbai/drainagemumbai.geojson`
- Mumbai terrain rasters in `data/mumbai`

### Sikkim assets

- `data/sikkim/sikkim_flood_model.py`
- `data/sikkim/data/Rivers.*`
- `data/sikkim/data/RF25_ind2001_rfp25.nc`
- `data/sikkim/data/*.tif`
- `data/sikkim/output/sikkim_flood_model.pkl`
- `data/sikkim/output/sikkim_predictions.csv`
- `models/sikkim/sikkim_flood_model.pkl`
- `python/sikkim_runtime.py`

## Latest UI State

The latest version includes:

- lighter, more readable operations dashboard
- larger section titles and cleaner stat cards
- city selector ribbon with Delhi / Mumbai / Sikkim tabs
- popup assistant chat at bottom-right
- dashboard summary grouped into a single overview card
- consistent severity colors and symbols across key screens
- map legend popup in the top-right area of the map

## Requirements

Current `requirements.txt`:

```text
fastapi>=0.104,<1.0
uvicorn[standard]>=0.24,<1.0
pydantic>=2.5,<3.0
python-dotenv>=1.0,<2.0

numpy>=1.26,<3.0
pandas>=2.1,<3.0
scipy>=1.11,<2.0
scikit-learn>=1.3,<2.0
joblib>=1.3,<2.0
xgboost>=2.0,<3.0
```

## Notes

- The project has legacy DFIS naming in a few file names and comments, but the current app branding is Drishti.
- Some UI IDs and route names are legacy for compatibility, especially `/yamuna`.
- The backend and live external APIs must be reachable for the full experience.
- Large raster and NetCDF assets are included in the repository, so clone/download size is heavier than a code-only project.
- `data.zip` exists in the repository root, but it is not required for runtime if the extracted `data/` directory is already present.

## Quick Start

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\start_api.bat
```

Then open:

```text
index.html
```

## Summary

Drishti is now a three-city flood intelligence platform with:

- city-specific forecasting logic
- map-based hotspot analysis
- water and rainfall monitoring
- readiness scoring
- alerts
- simulation
- routing
- popup assistant workflow

The current version is built to be run by cloning the repository, installing `requirements.txt`, starting the FastAPI backend, and opening the frontend.
