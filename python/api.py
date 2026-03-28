"""
DFIS API
Model-driven backend with no sample output values.
"""

import csv
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
from datetime import datetime, timedelta

import joblib
import numpy as np
import xgboost as xgb
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

import sikkim_runtime


warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.normpath(os.path.join(BASE_DIR, ".."))
load_dotenv(os.path.join(ROOT_DIR, ".env"))
MODELS_DIR = os.path.join(ROOT_DIR, "models")
GRID_PATH = os.path.join(ROOT_DIR, "delhi_grid_2800_cells.csv")
META_PATH = os.path.join(MODELS_DIR, "model_metadata.json")
SCALER_PARAMS_PATH = os.path.join(MODELS_DIR, "scaler_params.json")
XGB_JSON_PATH = os.path.join(MODELS_DIR, "xgboost_flood_model.json")
MUMBAI_DIR = os.path.join(ROOT_DIR, "data", "mumbai")
DELHI_HOTSPOTS_PATH = os.path.join(ROOT_DIR, "data", "hotspots_570.json")
MUMBAI_DATASET_PATH = os.path.join(MUMBAI_DIR, "mumbai_flood_dataset.csv")
MUMBAI_RAINFALL_PATH = os.path.join(MUMBAI_DIR, "mumbai_rainfall.csv")
MUMBAI_HOTSPOTS_PATH = os.path.join(MUMBAI_DIR, "mumbai_flood_hotspots.json")

DELHI_LAT = 28.6139
DELHI_LON = 77.2090
MUMBAI_LAT = 19.0760
MUMBAI_LON = 72.8777
LIVE_TTL_SECONDS = 300
PREDICTION_HORIZON_HOURS = 24
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyCZADRiWoL3u0lnqO_gHamBmNIvnuLEMPc").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
GEMINI_TIMEOUT_SECONDS = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "45"))

class RuntimeScaler:
    def __init__(self, mean_, scale_):
        self.mean_ = np.array(mean_, dtype=np.float32)
        self.scale_ = np.array(scale_, dtype=np.float32)

    def transform(self, values):
        arr = np.asarray(values, dtype=np.float32)
        return (arr - self.mean_) / self.scale_


class RuntimeXGBModel:
    def __init__(self, booster_path):
        self.booster = xgb.Booster()
        self.booster.load_model(booster_path)

    def predict_proba(self, values):
        dmatrix = xgb.DMatrix(values)
        probs = self.booster.predict(dmatrix)
        probs = np.asarray(probs, dtype=np.float32).reshape(-1, 1)
        return np.hstack([1.0 - probs, probs])


print("Loading models...")
if os.path.exists(XGB_JSON_PATH) and os.path.exists(SCALER_PARAMS_PATH):
    with open(SCALER_PARAMS_PATH, encoding="utf-8") as f:
        scaler_payload = json.load(f)
    xgb_model = RuntimeXGBModel(XGB_JSON_PATH)
    scaler = RuntimeScaler(scaler_payload["mean_"], scaler_payload["scale_"])
else:
    xgb_model = joblib.load(os.path.join(MODELS_DIR, "xgboost_flood_model.pkl"))
    scaler = joblib.load(os.path.join(MODELS_DIR, "scaler.pkl"))
with open(META_PATH, encoding="utf-8") as f:
    metadata = json.load(f)
THRESHOLD = float(metadata.get("best_threshold", 0.5))
FEATURES = metadata.get("features", [])
print("  [OK] Model artifacts loaded.")

lstm_model = None
print("  [WARN] LSTM not loaded - XGBoost only mode")


def _load_grid_cells():
    cells = []
    with open(GRID_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cells.append({
                "cell_id": row["cell_id"],
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "elevation_m": float(row["elevation_m"]),
                "slope_deg": float(row["slope_deg"]),
                "flow_accumulation": float(row["flow_accumulation"]),
                "drain_capacity_pct": float(row["drain_capacity_pct"]),
                "impervious_pct": float(row["impervious_pct"]),
            })
    return cells


GRID_CELLS = _load_grid_cells()
print(f"  [OK] Loaded {len(GRID_CELLS)} grid cells.")


def _load_mumbai_dataset():
    rows = []
    with open(MUMBAI_DATASET_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "Date": datetime.strptime(row["Date"], "%d-%m-%Y"),
                "Rainfall_mm": float(row["Rainfall_mm"]),
                "WaterLevel_m": float(row["WaterLevel_m"]),
                "SoilMoisture_pct": float(row["SoilMoisture_pct"]),
                "Elevation_m": float(row["Elevation_m"]),
                "FloodOccurrence": int(float(row["FloodOccurrence"])),
            })
    rows.sort(key=lambda item: item["Date"])
    return rows


def _load_mumbai_rainfall():
    rows = []
    with open(MUMBAI_RAINFALL_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def _load_delhi_hotspots():
    with open(DELHI_HOTSPOTS_PATH, encoding="utf-8") as f:
        return json.load(f)


with open(MUMBAI_HOTSPOTS_PATH, encoding="utf-8") as f:
    MUMBAI_HOTSPOTS = json.load(f)
DELHI_HOTSPOTS = _load_delhi_hotspots()
MUMBAI_DATASET = _load_mumbai_dataset()
MUMBAI_RAINFALL = _load_mumbai_rainfall()
MUMBAI_FEATURE_MATRIX = np.array([
    [row["Rainfall_mm"], row["WaterLevel_m"], row["SoilMoisture_pct"]]
    for row in MUMBAI_DATASET
], dtype=np.float32)
MUMBAI_TARGET = np.array([row["FloodOccurrence"] for row in MUMBAI_DATASET], dtype=np.float32)
MUMBAI_MEAN = MUMBAI_FEATURE_MATRIX.mean(axis=0)
MUMBAI_STD = np.where(MUMBAI_FEATURE_MATRIX.std(axis=0) == 0, 1.0, MUMBAI_FEATURE_MATRIX.std(axis=0))
print(f"  [OK] Loaded Mumbai dataset ({len(MUMBAI_DATASET)} rows) and {len(MUMBAI_HOTSPOTS)} hotspots.")
print(f"  [OK] Loaded Delhi hotspot catalog ({len(DELHI_HOTSPOTS)} hotspots).")
print("All models ready.\n")

app = FastAPI(
    title="DFIS API",
    description="Delhi Flood Intelligence System - Model-driven API",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_live_cache = {"ts": 0.0, "data": None}
_mumbai_marine_cache = {"ts": 0.0, "data": None}
_mumbai_weather_cache = {"ts": 0.0, "data": None}


def _normalise_city(city: str) -> str:
    value = (city or "delhi").strip().lower()
    if value == "mumbai":
        return "mumbai"
    if value == "sikkim":
        return "sikkim"
    return "delhi"


def _window_meta() -> tuple[str, str]:
    start = datetime.now().replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=PREDICTION_HORIZON_HOURS)
    return start.isoformat(), end.isoformat()


def _mumbai_monthly_mean(month_num: int) -> float:
    month_map = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "April", 5: "May", 6: "June",
        7: "July", 8: "Aug", 9: "Sept", 10: "Oct", 11: "Nov", 12: "Dec",
    }
    month_key = month_map.get(month_num, "July")
    vals = [float(row[month_key]) for row in MUMBAI_RAINFALL if row.get(month_key)]
    return round(sum(vals) / max(len(vals), 1), 1)


def _latest_mumbai_conditions() -> dict:
    latest = MUMBAI_DATASET[-1]
    month_num = datetime.now().month
    forecast_start, forecast_end = _window_meta()
    weather = _get_live_mumbai_weather()
    marine = _get_live_mumbai_marine()
    current_water_level_m = marine["sea_level_m"] if marine else latest["WaterLevel_m"]
    forecast_water_level_m = marine["forecast_peak_sea_level_m"] if marine else current_water_level_m
    forecast_rainfall_mm = weather["forecast_24h_mm"] if weather else latest["Rainfall_mm"]
    forecast_peak_mmhr = weather["forecast_peak_mmhr"] if weather else latest["Rainfall_mm"]
    next_day_mm = weather["next_day_mm"] if weather else _mumbai_monthly_mean(month_num) / 30.0
    rain_probability = weather["rain_probability"] if weather else int(min(100, round((latest["Rainfall_mm"] / max(_mumbai_monthly_mean(month_num), 1.0)) * 100)))
    soil_pct = weather["soil_pct"] if weather else latest["SoilMoisture_pct"]
    return {
        "timestamp": datetime.now().isoformat(),
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": forecast_start,
        "forecast_end": forecast_end,
        "current_rainfall_mm": weather["current_rainfall_mm"] if weather else latest["Rainfall_mm"],
        "rainfall_mm": forecast_peak_mmhr,
        "today_total_mm": forecast_rainfall_mm,
        "tomorrow_total_mm": next_day_mm,
        "rain_probability": rain_probability,
        "soil_pct": soil_pct,
        "water_level_m": forecast_water_level_m,
        "current_water_level_m": current_water_level_m,
        "elevation_m": latest["Elevation_m"],
        "month_mean_mm": _mumbai_monthly_mean(month_num),
        "temperature_c": weather["temperature_c"] if weather else None,
        "humidity_pct": weather["humidity_pct"] if weather else None,
        "wind_kmh": weather["wind_kmh"] if weather else None,
        "chart_vals": weather["chart_vals"] if weather else [round(row["Rainfall_mm"], 1) for row in MUMBAI_DATASET[-12:]],
        "chart_hours": weather["chart_hours"] if weather else [str(idx * 2).zfill(2) for idx in range(12)],
        "water_level_source": marine["source"] if marine else "Mumbai flood dataset fallback",
        "rainfall_source": "Open-Meteo forecast" if weather else "Mumbai flood dataset fallback",
    }


def _mumbai_chart_payload() -> tuple[list, list]:
    live = _latest_mumbai_conditions()
    return live["chart_hours"], live["chart_vals"]


def _mumbai_predict_probability(rainfall_mm: float, water_level_m: float, soil_pct: float) -> float:
    query = np.array([rainfall_mm, water_level_m, soil_pct], dtype=np.float32)
    norm_query = (query - MUMBAI_MEAN) / MUMBAI_STD
    norm_data = (MUMBAI_FEATURE_MATRIX - MUMBAI_MEAN) / MUMBAI_STD
    distances = np.sqrt(np.sum((norm_data - norm_query) ** 2, axis=1))
    k = min(25, len(distances))
    idx = np.argsort(distances)[:k]
    weights = 1.0 / (distances[idx] + 1e-6)
    prob = float(np.sum(weights * MUMBAI_TARGET[idx]) / np.sum(weights))
    return round(prob, 4)


def _mumbai_predict_payload(rainfall_mm: float, water_level_m: float, soil_pct: float) -> dict:
    prob = _mumbai_predict_probability(rainfall_mm, water_level_m, soil_pct)
    risk = _risk_label(prob)
    forecast_start, forecast_end = _window_meta()
    return {
        "flood_probability": prob,
        "flood_predicted": int(prob >= 0.5),
        "risk_level": risk["level"],
        "risk_color": risk["color"],
        "risk_code": risk["code"],
        "threshold_used": 0.5,
        "model": "mumbai_knn_dataset_v1",
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": forecast_start,
        "forecast_end": forecast_end,
        "basis": "next_24h_live_forecast",
    }


def _mumbai_hotspots(limit: int, risk: str) -> list:
    live = _latest_mumbai_conditions()
    return _mumbai_hotspots_for_live(live, limit, risk)


def _mumbai_hotspots_for_live(live: dict, limit: int, risk: str) -> list:
    base_prob = _mumbai_predict_probability(
        live["rainfall_mm"],
        live["water_level_m"],
        live["soil_pct"],
    )
    rows = []
    for hotspot in MUMBAI_HOTSPOTS:
        elevation_m = float(hotspot.get("elevation_m", 0.0))
        waterway_proximity = float(hotspot.get("waterway_proximity", 0.0))
        elevation_factor = _clamp((6.0 - elevation_m) / 6.0, 0.0, 1.0)
        waterway_factor = _clamp(waterway_proximity, 0.0, 1.0)
        probability = round(_clamp(base_prob * 0.45 + elevation_factor * 0.35 + waterway_factor * 0.20, 0.02, 0.98), 4)
        risk_meta = _risk_label(probability)
        level = risk_meta["level"]
        if risk != "all" and level != risk.upper():
            continue
        rows.append({
            "cell_id": hotspot["id"],
            "name": hotspot["name"],
            "lat": hotspot["lat"],
            "lon": hotspot["lon"],
            "district": hotspot.get("ward", "Mumbai"),
            "probability": probability,
            "risk_level": level,
            "risk_color": risk_meta["color"],
            "risk_code": risk_meta["code"],
            "elevation_m": elevation_m,
            "slope_deg": 0.0,
            "flow_accumulation": 0.0,
            "drain_capacity_pct": round(max(0.0, 100.0 - waterway_proximity * 100.0), 1),
            "impervious_pct": 70.0,
            "yamuna_proximity_m": 0.0,
        })
    rows.sort(key=lambda item: item["probability"], reverse=True)
    return rows[:limit]


def _mumbai_wards() -> list:
    grouped = {}
    for hotspot in MUMBAI_HOTSPOTS:
        ward = hotspot.get("ward", "Mumbai")
        grouped.setdefault(ward, []).append(hotspot)
    rows = []
    for ward, items in grouped.items():
        avg_score = sum(float(item.get("risk_score", 0.0)) for item in items) / len(items)
        avg_prob = sum(float(item.get("probability", 0.0)) for item in items) / len(items)
        drainage = round(max(0.0, 100.0 - sum(float(item.get("waterway_proximity", 0.0)) for item in items) * 100.0 / len(items)), 1)
        pumps = round(max(0.0, 100.0 - avg_prob * 60.0), 1)
        roads = round(max(0.0, 100.0 - avg_score * 0.45), 1)
        emergency = round(max(0.0, 100.0 - avg_prob * 50.0), 1)
        preparedness = round(max(0.0, 100.0 - avg_score * 0.35), 1)
        readiness = round(drainage * 0.30 + pumps * 0.25 + roads * 0.20 + emergency * 0.15 + preparedness * 0.10, 1)
        rows.append({
            "ward": ward,
            "district": "Mumbai",
            "readiness_score": readiness,
            "readiness_level": _readiness_level(readiness),
            "components": {
                "drainage": drainage,
                "pumps": pumps,
                "roads": roads,
                "emergency": emergency,
                "preparedness": preparedness,
            },
        })
    rows.sort(key=lambda item: item["readiness_score"])
    return rows


def _delhi_base_probability(score: float) -> float:
    return round(_clamp(float(score) / 100.0, 0.02, 0.98), 4)


def _delhi_risk_meta(level: str, score: float) -> dict:
    value = (level or "").strip().upper()
    if value == "MEDIUM":
        value = "MODERATE"
    if value in ["CRITICAL", "HIGH", "MODERATE", "LOW"]:
        mapping = {
            "CRITICAL": {"level": "CRITICAL", "color": "#DC2626", "code": 4},
            "HIGH": {"level": "HIGH", "color": "#EA580C", "code": 3},
            "MODERATE": {"level": "MODERATE", "color": "#D97706", "code": 2},
            "LOW": {"level": "LOW", "color": "#16A34A", "code": 1},
        }
        return mapping[value]
    return _risk_label(_delhi_base_probability(score))

def _delhi_city_pressure(live: dict) -> float:
    city_pred = _predict_summary(live)
    rain_pressure = _clamp(max(float(live["rainfall_mm"]), float(live["today_total_mm"]) / 6.0) / 40.0, 0.0, 1.0)
    water_pressure = _clamp((float(live["yamuna_level_m"]) - 203.8) / 1.7, 0.0, 1.0)
    soil_pressure = _clamp(float(live["soil_pct"]) / 100.0, 0.0, 1.0) * 0.45
    return _clamp(
        city_pred["flood_probability"] * 0.50 + rain_pressure * 0.25 + water_pressure * 0.15 + soil_pressure * 0.10,
        0.0,
        1.0,
    )


def _delhi_adjusted_probability(hotspot: dict, city_pressure: float) -> float:
    base_prob = _delhi_base_probability(float(hotspot.get("risk_score", 0.0)))
    drainage_raw = float(hotspot.get("drain_capacity_pct", 0.0))
    impervious_raw = float(hotspot.get("impervious_pct", 0.0))
    drainage_pct = drainage_raw * 100.0 if drainage_raw <= 1.0 else drainage_raw
    impervious_pct = impervious_raw * 100.0 if impervious_raw <= 1.0 else impervious_raw
    proximity_m = float(hotspot.get("yamuna_proximity_m", 2500.0))

    drainage_stress = _clamp((100.0 - drainage_pct) / 100.0, 0.0, 1.0)
    impervious_stress = _clamp(impervious_pct / 100.0, 0.0, 1.0)
    proximity_stress = _clamp((2000.0 - proximity_m) / 2000.0, 0.0, 1.0)
    local_vulnerability = _clamp(
        drainage_stress * 0.40 + impervious_stress * 0.35 + proximity_stress * 0.25,
        0.0,
        1.0,
    )

    multiplier = 0.18 + local_vulnerability * 0.42 + city_pressure * 0.40
    return round(_clamp(base_prob * multiplier, 0.02, 0.98), 4)


def _delhi_hotspots(live: dict, limit: int, risk: str) -> list:
    city_pressure = _delhi_city_pressure(live)
    rows = []
    for hotspot in DELHI_HOTSPOTS:
        score = float(hotspot.get("risk_score", 0.0))
        adjusted_prob = _delhi_adjusted_probability(hotspot, city_pressure)
        risk_meta = _risk_label(adjusted_prob)
        level = risk_meta["level"]
        if risk != "all" and level != risk.upper():
            continue

        drainage_raw = float(hotspot.get("drain_capacity_pct", 0.0))
        impervious_raw = float(hotspot.get("impervious_pct", 0.0))
        drainage_pct = round(drainage_raw * 100.0, 1) if drainage_raw <= 1.0 else round(drainage_raw, 1)
        impervious_pct = round(impervious_raw * 100.0, 1) if impervious_raw <= 1.0 else round(impervious_raw, 1)

        rows.append({
            "cell_id": hotspot["id"],
            "name": hotspot["name"],
            "lat": float(hotspot["lat"]),
            "lon": float(hotspot["lon"]),
            "district": hotspot.get("district", "Delhi"),
            "probability": adjusted_prob,
            "risk_level": level,
            "risk_color": risk_meta["color"],
            "risk_code": risk_meta["code"],
            "risk_score": round(adjusted_prob * 100.0, 1),
            "base_risk_score": round(score, 1),
            "cause": hotspot.get("cause", "Calculated by Delhi hotspot model"),
            "elevation_m": round(float(hotspot.get("elevation_m", 0.0)), 2),
            "slope_deg": 0.0,
            "flow_accumulation": 0.0,
            "drain_capacity_pct": drainage_pct,
            "impervious_pct": impervious_pct,
            "yamuna_proximity_m": round(float(hotspot.get("yamuna_proximity_m", 0.0)), 1),
            "source": hotspot.get("source", "hotspots_570"),
        })
    rows.sort(key=lambda item: (item["risk_code"], item["risk_score"]), reverse=True)
    return rows[:limit]


def _delhi_wards(live: dict) -> list:
    hotspot_rows = _delhi_hotspots(live, len(DELHI_HOTSPOTS), "all")
    grouped = {}
    for hotspot in hotspot_rows:
        district = hotspot.get("district", "Delhi")
        grouped.setdefault(district, []).append(hotspot)

    rows = []
    for district, items in grouped.items():
        avg_score = sum(float(item.get("risk_score", 0.0)) for item in items) / len(items)
        drainage = round(sum(float(item.get("drain_capacity_pct", 0.0)) for item in items) / len(items), 1)
        impervious = round(sum(float(item.get("impervious_pct", 0.0)) for item in items) / len(items), 1)
        pumps = round(_clamp(100.0 - avg_score * 0.75, 0.0, 100.0), 1)
        roads = round(_clamp(100.0 - impervious * 0.45, 0.0, 100.0), 1)
        emergency = round(_clamp(100.0 - avg_score * 0.70, 0.0, 100.0), 1)
        preparedness = round(_clamp(100.0 - avg_score * 0.50, 0.0, 100.0), 1)
        readiness = round(drainage * 0.30 + pumps * 0.25 + roads * 0.20 + emergency * 0.15 + preparedness * 0.10, 1)
        rows.append({
            "ward": district,
            "district": district,
            "readiness_score": readiness,
            "readiness_level": _readiness_level(readiness),
            "components": {
                "drainage": drainage,
                "pumps": pumps,
                "roads": roads,
                "emergency": emergency,
                "preparedness": preparedness,
            },
        })
    rows.sort(key=lambda item: item["readiness_score"])
    return rows


def _fetch_json(base_url: str, params: dict) -> dict:
    url = base_url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _forecast_index(hourly_times: list, current_time_iso: str | None) -> int:
    if current_time_iso and current_time_iso in hourly_times:
        return hourly_times.index(current_time_iso)
    return 0


def _sum_window(values: list, start: int, width: int) -> float:
    return round(sum(float(values[i] or 0.0) for i in range(start, min(len(values), start + width))), 1)


def _max_window(values: list, start: int, width: int) -> float:
    window = [float(values[i] or 0.0) for i in range(start, min(len(values), start + width))]
    return round(max(window) if window else 0.0, 1)


def _get_live_mumbai_marine(force_refresh: bool = False) -> dict | None:
    now = time.time()
    if not force_refresh and _mumbai_marine_cache["data"] and now - _mumbai_marine_cache["ts"] < LIVE_TTL_SECONDS:
        return _mumbai_marine_cache["data"]

    try:
        marine = _fetch_json(
            "https://marine-api.open-meteo.com/v1/marine",
            {
                "latitude": MUMBAI_LAT,
                "longitude": MUMBAI_LON,
                "hourly": "sea_level_height_msl",
                "forecast_hours": PREDICTION_HORIZON_HOURS,
                "timezone": "Asia/Kolkata",
                "cell_selection": "sea",
            },
        )
        hourly = marine.get("hourly", {})
        sea_levels = hourly.get("sea_level_height_msl") or []
        current_sea_level = float(sea_levels[0]) if sea_levels else None
        if current_sea_level is None:
            return None
        payload = {
            "sea_level_m": round(current_sea_level, 3),
            "forecast_peak_sea_level_m": round(max(float(v or 0.0) for v in sea_levels), 3),
            "source": "Open-Meteo Marine API",
        }
        _mumbai_marine_cache["ts"] = now
        _mumbai_marine_cache["data"] = payload
        return payload
    except Exception:
        return None


def _get_live_mumbai_weather(force_refresh: bool = False) -> dict | None:
    now = time.time()
    if not force_refresh and _mumbai_weather_cache["data"] and now - _mumbai_weather_cache["ts"] < LIVE_TTL_SECONDS:
        return _mumbai_weather_cache["data"]

    try:
        weather = _fetch_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": MUMBAI_LAT,
                "longitude": MUMBAI_LON,
                "current": "precipitation,rain,temperature_2m,relative_humidity_2m,wind_speed_10m",
                "hourly": "precipitation,soil_moisture_0_to_1cm",
                "daily": "precipitation_sum,precipitation_probability_max",
                "timezone": "Asia/Kolkata",
                "forecast_days": 3,
            },
        )
        current = weather.get("current", {})
        hourly = weather.get("hourly", {})
        daily = weather.get("daily", {})
        hourly_precip = hourly.get("precipitation") or []
        hourly_soil = hourly.get("soil_moisture_0_to_1cm") or []
        hourly_times = hourly.get("time") or []
        start_idx = _forecast_index(hourly_times, current.get("time"))

        payload = {
            "current_rainfall_mm": round(float(current.get("precipitation", 0.0) or 0.0), 1),
            "forecast_24h_mm": _sum_window(hourly_precip, start_idx, PREDICTION_HORIZON_HOURS),
            "forecast_peak_mmhr": _max_window(hourly_precip, start_idx, PREDICTION_HORIZON_HOURS),
            "next_day_mm": _sum_window(hourly_precip, start_idx + PREDICTION_HORIZON_HOURS, PREDICTION_HORIZON_HOURS),
            "rain_probability": int(max((daily.get("precipitation_probability_max") or [0])[:2] or [0])),
            "soil_pct": round(_clamp(float(hourly_soil[start_idx] if start_idx < len(hourly_soil) else 0.5) * 100.0, 0.0, 100.0)),
            "temperature_c": current.get("temperature_2m"),
            "humidity_pct": current.get("relative_humidity_2m"),
            "wind_kmh": current.get("wind_speed_10m"),
            "chart_vals": [round(float(hourly_precip[i] or 0.0), 1) if i < len(hourly_precip) else 0.0 for i in range(start_idx, min(len(hourly_precip), start_idx + PREDICTION_HORIZON_HOURS), 2)],
            "chart_hours": [str(i).zfill(2) for i in range(0, min(PREDICTION_HORIZON_HOURS, 24), 2)],
        }
        _mumbai_weather_cache["ts"] = now
        _mumbai_weather_cache["data"] = payload
        return payload
    except Exception:
        return None


def _clamp(value, low, high):
    return max(low, min(high, value))


def _risk_label(prob: float) -> dict:
    if prob >= 0.75:
        return {"level": "CRITICAL", "color": "#DC2626", "code": 4}
    if prob >= 0.50:
        return {"level": "HIGH", "color": "#EA580C", "code": 3}
    if prob >= 0.25:
        return {"level": "MODERATE", "color": "#D97706", "code": 2}
    return {"level": "LOW", "color": "#16A34A", "code": 1}


def _district_from_lat_lon(lat: float, lon: float) -> str:
    if lon >= 77.28:
        return "East"
    if lon >= 77.24:
        return "Shahdara" if lat >= 28.67 else "East"
    if lat >= 28.74:
        return "North"
    if lat >= 28.68 and lon < 77.16:
        return "NW Delhi"
    if lat >= 28.66:
        return "North"
    if lat >= 28.60 and lon < 77.14:
        return "West"
    if lat >= 28.60:
        return "Central"
    if lon < 77.14:
        return "SW Delhi"
    return "South"


def _yamuna_proximity_m(lat: float, lon: float) -> float:
    river_lon = 77.27 - max(0.0, lat - 28.45) * 0.12
    meters_per_deg_lon = 111_320 * math.cos(math.radians(lat))
    return abs(lon - river_lon) * meters_per_deg_lon


def _drain_blockage_idx(cell: dict, soil_pct: float, rainfall_mm: float) -> float:
    capacity_penalty = 1.0 - _clamp(cell["drain_capacity_pct"] / 100.0, 0.0, 1.0)
    impervious_factor = _clamp(cell["impervious_pct"] / 100.0, 0.0, 1.0)
    saturation_factor = _clamp(soil_pct / 100.0, 0.0, 1.0)
    rainfall_factor = _clamp(rainfall_mm / 100.0, 0.0, 1.0)
    return round(_clamp(capacity_penalty * 0.45 + impervious_factor * 0.25 + saturation_factor * 0.15 + rainfall_factor * 0.15, 0.0, 1.0), 4)


def _get_live_inputs(force_refresh: bool = False) -> dict:
    now = time.time()
    if not force_refresh and _live_cache["data"] and now - _live_cache["ts"] < LIVE_TTL_SECONDS:
        return _live_cache["data"]

    try:
        weather = _fetch_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": DELHI_LAT,
                "longitude": DELHI_LON,
                "current": "precipitation,rain,temperature_2m,relative_humidity_2m,wind_speed_10m",
                "hourly": "precipitation,soil_moisture_0_to_1cm",
                "daily": "precipitation_sum,precipitation_probability_max",
                "timezone": "Asia/Kolkata",
                "forecast_days": 3,
            },
        )
        flood = _fetch_json(
            "https://flood-api.open-meteo.com/v1/flood",
            {
                "latitude": DELHI_LAT,
                "longitude": DELHI_LON,
                "daily": "river_discharge",
                "forecast_days": 3,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Live data fetch failed: {exc}") from exc

    current = weather.get("current", {})
    hourly = weather.get("hourly", {})
    daily = weather.get("daily", {})
    flood_daily = flood.get("daily", {})

    hourly_times = hourly.get("time") or []
    current_idx = _forecast_index(hourly_times, current.get("time"))

    current_mm = float(current.get("precipitation", 0.0) or 0.0)
    next_24_total = _sum_window(hourly.get("precipitation") or [], current_idx, PREDICTION_HORIZON_HOURS)
    following_24_total = _sum_window(hourly.get("precipitation") or [], current_idx + PREDICTION_HORIZON_HOURS, PREDICTION_HORIZON_HOURS)
    next_24_peak = _max_window(hourly.get("precipitation") or [], current_idx, PREDICTION_HORIZON_HOURS)
    rain_prob = int(max((daily.get("precipitation_probability_max") or [0, 0])[:2] or [0]))
    soil_raw = float((hourly.get("soil_moisture_0_to_1cm") or [0.5])[current_idx] if current_idx < len(hourly.get("soil_moisture_0_to_1cm") or [0.5]) else 0.5)
    soil_pct = round(_clamp(soil_raw * 100.0, 0.0, 100.0))

    hourly_precip = hourly.get("precipitation") or []
    chart_vals = [round(float(hourly_precip[i] or 0.0), 1) if i < len(hourly_precip) else 0.0 for i in range(current_idx, min(len(hourly_precip), current_idx + PREDICTION_HORIZON_HOURS), 2)]
    chart_hours = [str(i).zfill(2) for i in range(0, min(PREDICTION_HORIZON_HOURS, 24), 2)]

    discharge_series = flood_daily.get("river_discharge") or [0.0, 0.0, 0.0]
    discharge_now = float(discharge_series[0] or 0.0)
    discharge_next = float(discharge_series[1] or discharge_now)
    discharge_forecast = max(discharge_now, discharge_next)
    current_yamuna_level = round(_clamp(200.0 + discharge_now / 1350.0, 201.0, 208.0), 2)
    yamuna_level = round(_clamp(200.0 + discharge_forecast / 1350.0, 201.0, 208.0), 2)
    yamuna_change = round((discharge_forecast - discharge_now) / 1350.0, 3)
    yamuna_status = "DANGER" if yamuna_level >= 205.33 else "WARNING" if yamuna_level >= 204.50 else "NORMAL"
    forecast_start, forecast_end = _window_meta()

    live = {
        "timestamp": datetime.now().isoformat(),
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": forecast_start,
        "forecast_end": forecast_end,
        "current_rainfall_mm": current_mm,
        "rainfall_mm": next_24_peak,
        "today_total_mm": next_24_total,
        "tomorrow_total_mm": following_24_total,
        "rain_probability": rain_prob,
        "soil_pct": soil_pct,
        "soil_raw": soil_raw,
        "chart_vals": chart_vals,
        "chart_hours": chart_hours,
        "temperature_c": current.get("temperature_2m"),
        "humidity_pct": current.get("relative_humidity_2m"),
        "wind_kmh": current.get("wind_speed_10m"),
        "discharge_m3s": discharge_forecast,
        "current_discharge_m3s": discharge_now,
        "current_yamuna_level_m": current_yamuna_level,
        "yamuna_level_m": yamuna_level,
        "yamuna_level_change": yamuna_change,
        "yamuna_status": yamuna_status,
    }
    _live_cache["ts"] = now
    _live_cache["data"] = live
    return live


def _build_feature_vector(cell: dict, live: dict, month: int = None) -> np.ndarray:
    if month is None:
        month = datetime.now().month

    rainfall_mm = float(live["rainfall_mm"])
    today_total = float(live["today_total_mm"])
    tomorrow_total = float(live["tomorrow_total_mm"])
    soil_pct = float(live["soil_pct"])
    yamuna_level = float(live["yamuna_level_m"])
    yamuna_change = float(live["yamuna_level_change"])
    yamuna_discharge = float(live["discharge_m3s"])

    rainfall_max = max(rainfall_mm, today_total)
    rainfall_intensity = rainfall_mm
    rainfall_3day = today_total * 1.4 + tomorrow_total * 0.4 + rainfall_mm
    rainfall_7day = rainfall_3day * 2.2
    rainfall_15day = rainfall_7day * 2.1
    is_monsoon = 1 if month in [6, 7, 8, 9] else 0
    monsoon_day = max(0, datetime.now().timetuple().tm_yday - 151) if is_monsoon else 0
    drain_blockage_idx = _drain_blockage_idx(cell, soil_pct, rainfall_mm)
    yamuna_proximity = _yamuna_proximity_m(cell["lat"], cell["lon"])

    return np.array([
        rainfall_mm,
        rainfall_max,
        rainfall_intensity,
        rainfall_3day,
        rainfall_7day,
        rainfall_15day,
        soil_pct,
        is_monsoon,
        monsoon_day,
        yamuna_level,
        yamuna_change,
        yamuna_discharge,
        cell["elevation_m"],
        cell["slope_deg"],
        cell["flow_accumulation"],
        cell["drain_capacity_pct"],
        cell["impervious_pct"],
        drain_blockage_idx,
        yamuna_proximity,
    ], dtype=np.float32)


def _predict_probability_from_vector(vector: np.ndarray) -> float:
    scaled = scaler.transform(vector.reshape(1, -1))
    return float(xgb_model.predict_proba(scaled)[0][1])


def _predict_cell(cell: dict, live: dict) -> dict:
    vector = _build_feature_vector(cell, live)
    prob = _predict_probability_from_vector(vector)
    risk = _risk_label(prob)
    return {
        "cell_id": cell["cell_id"],
        "name": cell["cell_id"],
        "lat": cell["lat"],
        "lon": cell["lon"],
        "district": _district_from_lat_lon(cell["lat"], cell["lon"]),
        "probability": round(prob, 4),
        "risk_level": risk["level"],
        "risk_color": risk["color"],
        "risk_code": risk["code"],
        "elevation_m": round(cell["elevation_m"], 2),
        "slope_deg": round(cell["slope_deg"], 3),
        "flow_accumulation": round(cell["flow_accumulation"], 2),
        "drain_capacity_pct": round(cell["drain_capacity_pct"], 1),
        "impervious_pct": round(cell["impervious_pct"], 1),
        "yamuna_proximity_m": round(float(vector[-1]), 1),
    }


def _compute_all_cells(live: dict) -> list:
    results = [_predict_cell(cell, live) for cell in GRID_CELLS]
    results.sort(key=lambda item: item["probability"], reverse=True)
    return results


def _diversify_hotspots(results: list, limit: int) -> list:
    selected = []
    used_buckets = set()
    lat_step = 0.05
    lon_step = 0.05

    for item in results:
        bucket = (
            int((item["lat"] - 28.0) / lat_step),
            int((item["lon"] - 76.5) / lon_step),
        )
        if bucket in used_buckets:
            continue
        selected.append(item)
        used_buckets.add(bucket)
        if len(selected) >= limit:
            return selected

    if len(selected) < limit:
        seen_ids = {item["cell_id"] for item in selected}
        for item in results:
            if item["cell_id"] in seen_ids:
                continue
            selected.append(item)
            if len(selected) >= limit:
                break
    return selected


def _readiness_level(score: float) -> str:
    if score < 40:
        return "CRITICAL"
    if score < 70:
        return "MODERATE"
    return "GOOD"


def _compute_readiness_rows(cells: list) -> list:
    rows = []
    for cell in cells:
        flood_prob = cell["probability"] * 100.0
        drainage = round(cell["drain_capacity_pct"], 1)
        pumps = round(_clamp(100.0 - flood_prob * 0.55, 0.0, 100.0), 1)
        roads = round(_clamp(100.0 - cell["impervious_pct"] * 0.45, 0.0, 100.0), 1)
        emergency = round(_clamp(100.0 - flood_prob * 0.65 + cell["slope_deg"] * 8.0, 0.0, 100.0), 1)
        preparedness = round(_clamp(100.0 - flood_prob * 0.5, 0.0, 100.0), 1)
        score = round(drainage * 0.30 + pumps * 0.25 + roads * 0.20 + emergency * 0.15 + preparedness * 0.10, 1)
        level = _readiness_level(score)
        rows.append({
            "ward": cell["cell_id"],
            "district": cell["district"],
            "readiness_score": score,
            "readiness_level": level,
            "components": {
                "drainage": drainage,
                "pumps": pumps,
                "roads": roads,
                "emergency": emergency,
                "preparedness": preparedness,
            },
        })
    rows.sort(key=lambda item: item["readiness_score"])
    return rows


def _predict_summary(live: dict) -> dict:
    vector = np.array([
        live["rainfall_mm"],
        max(live["rainfall_mm"], live["today_total_mm"]),
        live["rainfall_mm"],
        live["today_total_mm"] * 1.4 + live["tomorrow_total_mm"] * 0.4 + live["rainfall_mm"],
        (live["today_total_mm"] * 1.4 + live["tomorrow_total_mm"] * 0.4 + live["rainfall_mm"]) * 2.2,
        ((live["today_total_mm"] * 1.4 + live["tomorrow_total_mm"] * 0.4 + live["rainfall_mm"]) * 2.2) * 2.1,
        live["soil_pct"],
        1 if datetime.now().month in [6, 7, 8, 9] else 0,
        max(0, datetime.now().timetuple().tm_yday - 151),
        live["yamuna_level_m"],
        live["yamuna_level_change"],
        live["discharge_m3s"],
        float(np.mean([c["elevation_m"] for c in GRID_CELLS])),
        float(np.mean([c["slope_deg"] for c in GRID_CELLS])),
        float(np.mean([c["flow_accumulation"] for c in GRID_CELLS])),
        float(np.mean([c["drain_capacity_pct"] for c in GRID_CELLS])),
        float(np.mean([c["impervious_pct"] for c in GRID_CELLS])),
        float(np.mean([_drain_blockage_idx(c, live["soil_pct"], live["rainfall_mm"]) for c in GRID_CELLS])),
        float(np.mean([_yamuna_proximity_m(c["lat"], c["lon"]) for c in GRID_CELLS])),
    ], dtype=np.float32)
    prob = _predict_probability_from_vector(vector)
    risk = _risk_label(prob)
    return {
        "flood_probability": round(prob, 4),
        "flood_predicted": int(prob >= THRESHOLD),
        "risk_level": risk["level"],
        "risk_color": risk["color"],
        "risk_code": risk["code"],
        "threshold_used": THRESHOLD,
        "model": "xgboost_v1",
        "horizon_hours": live.get("horizon_hours", PREDICTION_HORIZON_HOURS),
        "forecast_start": live.get("forecast_start"),
        "forecast_end": live.get("forecast_end"),
        "basis": "next_24h_live_forecast",
    }


@app.get("/")
def root():
    return {"message": "Dhristi API is running", "docs": "/docs"}


@app.get("/status")
def status(city: str = Query("delhi", description="City: delhi / mumbai / sikkim")):
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        df = sikkim_runtime.run_pipeline_for_live(live)
        return sikkim_runtime.status_payload(live, df)
    if city == "mumbai":
        live = _latest_mumbai_conditions()
        city_pred = _mumbai_predict_payload(
            live["rainfall_mm"],
            live["water_level_m"],
            live["soil_pct"],
        )
        return {
            "status": "online",
            "city": city,
            "timestamp": datetime.now().isoformat(),
            "model_version": "mumbai_knn_dataset_v1",
            "trained_on": "mumbai_flood_dataset.csv",
            "train_years": "dataset-backed historical observations",
            "total_rows": len(MUMBAI_DATASET),
            "metrics": {
                "auc_roc": None,
                "threshold": 0.5,
                "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
            },
            "n_features": 3,
            "features": ["Rainfall_mm", "WaterLevel_m", "SoilMoisture_pct"],
            "grid_cells": len(MUMBAI_HOTSPOTS),
            "live_inputs": live,
            "city_prediction": city_pred,
            "prediction_basis": "next_24h_live_forecast",
        }

    live = _get_live_inputs()
    city_pred = _predict_summary(live)
    return {
        "status": "online",
        "city": city,
        "timestamp": datetime.now().isoformat(),
        "model_version": metadata.get("model_version", "1.0"),
        "trained_on": metadata.get("trained_on"),
        "train_years": metadata.get("train_years"),
        "total_rows": metadata.get("rows"),
        "metrics": {
            "auc_roc": metadata.get("auc"),
            "threshold": THRESHOLD,
            "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
        },
        "n_features": len(FEATURES),
        "features": FEATURES,
        "grid_cells": len(DELHI_HOTSPOTS),
        "live_inputs": live,
        "city_prediction": city_pred,
        "prediction_basis": "next_24h_live_forecast",
    }


@app.get("/predict")
def predict(
    rainfall_mm: float = Query(..., description="Forecast peak rainfall mm/hr over next 24 hours"),
    rainfall_total_mm: float = Query(None, description="Forecast accumulated rainfall mm over next 24 hours"),
    yamuna_level: float = Query(..., description="Forecast peak water level in meters over next 24 hours"),
    soil_saturation: float = Query(..., description="Projected soil saturation 0-100% over next 24 hours"),
    month: int = Query(None, description="Month 1-12"),
    city: str = Query("delhi", description="City: delhi / mumbai / sikkim"),
):
    city = _normalise_city(city)
    rainfall_total = rainfall_total_mm if rainfall_total_mm is not None else rainfall_mm
    if city == "sikkim":
        forecast_start, forecast_end = _window_meta()
        live = {
            **sikkim_runtime.get_live_inputs(),
            "timestamp": datetime.now().isoformat(),
            "forecast_start": forecast_start,
            "forecast_end": forecast_end,
            "rainfall_mm": rainfall_mm,
            "today_total_mm": rainfall_total,
            "tomorrow_total_mm": rainfall_total * 0.5,
            "soil_pct": soil_saturation,
            "water_level_m": yamuna_level,
            "current_level_m": yamuna_level,
            "water_level_change": 0.0,
            "discharge_m3s": max(0.0, (yamuna_level - 4.0) * 180.0),
            "current_discharge_m3s": max(0.0, (yamuna_level - 4.0) * 180.0),
            "water_status": "DANGER" if yamuna_level >= 12.0 else "WARNING" if yamuna_level >= 9.0 else "NORMAL",
        }
        df = sikkim_runtime.run_pipeline_for_live(live=live, force_refresh=True)
        result = sikkim_runtime.predict_summary(live, df)
        result["inputs"] = {
            "forecast_peak_rainfall_mmhr": rainfall_mm,
            "forecast_total_rainfall_mm": rainfall_total,
            "forecast_peak_water_level_m": yamuna_level,
            "forecast_soil_saturation": soil_saturation,
        }
        result["timestamp"] = datetime.now().isoformat()
        result["city"] = city
        return result
    if city == "mumbai":
        result = _mumbai_predict_payload(rainfall_total, yamuna_level, soil_saturation)
        result["inputs"] = {
            "forecast_peak_rainfall_mmhr": rainfall_mm,
            "forecast_total_rainfall_mm": rainfall_total,
            "forecast_peak_water_level_m": yamuna_level,
            "forecast_soil_saturation": soil_saturation,
        }
        result["timestamp"] = datetime.now().isoformat()
        result["city"] = city
        return result

    reference_cell = GRID_CELLS[len(GRID_CELLS) // 2]
    forecast_start, forecast_end = _window_meta()
    live = {
        "rainfall_mm": rainfall_mm,
        "today_total_mm": rainfall_total,
        "tomorrow_total_mm": rainfall_total * 0.5,
        "soil_pct": soil_saturation,
        "yamuna_level_m": yamuna_level,
        "yamuna_level_change": 0.0,
        "discharge_m3s": max(0.0, (yamuna_level - 200.0) * 1350.0),
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": forecast_start,
        "forecast_end": forecast_end,
    }
    vector = _build_feature_vector(reference_cell, live, month)
    prob = _predict_probability_from_vector(vector)
    risk = _risk_label(prob)
    return {
        "flood_probability": round(prob, 4),
        "flood_predicted": int(prob >= THRESHOLD),
        "risk_level": risk["level"],
        "risk_color": risk["color"],
        "risk_code": risk["code"],
        "threshold_used": THRESHOLD,
        "model": "xgboost_v1",
        "inputs": {
            "forecast_peak_rainfall_mmhr": rainfall_mm,
            "forecast_total_rainfall_mm": rainfall_total,
            "forecast_peak_water_level_m": yamuna_level,
            "forecast_soil_saturation": soil_saturation,
        },
        "timestamp": datetime.now().isoformat(),
        "city": city,
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "basis": "next_24h_live_forecast",
    }


@app.get("/rainfall")
def rainfall(city: str = Query("delhi", description="City: delhi / mumbai / sikkim")):
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        df = sikkim_runtime.run_pipeline_for_live(live)
        return sikkim_runtime.rainfall_payload(live, df)
    if city == "mumbai":
        live = _latest_mumbai_conditions()
        chart_hours, chart_vals = _mumbai_chart_payload()
        flood_risk = _mumbai_predict_payload(
            live["rainfall_mm"],
            live["water_level_m"],
            live["soil_pct"],
        )
        mm = live["rainfall_mm"]
        category = "LIGHT" if mm < 2.5 else "MODERATE" if mm < 7.6 else "HEAVY" if mm < 35.5 else "VERY HEAVY"
        return {
            "city": city,
            "current_mm_hr": live["current_rainfall_mm"],
            "forecast_peak_mm_hr": mm,
            "next_24h_total_mm": live["today_total_mm"],
            "following_24h_total_mm": round(live["tomorrow_total_mm"], 1),
            "rain_probability": live["rain_probability"],
            "category": category,
            "chart_hours": chart_hours,
            "chart_vals": chart_vals,
            "flood_risk": flood_risk,
            "timestamp": live["timestamp"],
            "horizon_hours": PREDICTION_HORIZON_HOURS,
            "forecast_start": live["forecast_start"],
            "forecast_end": live["forecast_end"],
            "source": live["rainfall_source"] + " + Mumbai hotspot model",
        }

    live = _get_live_inputs()
    flood_risk = _predict_summary(live)
    mm = live["rainfall_mm"]
    category = "LIGHT" if mm < 2.5 else "MODERATE" if mm < 7.6 else "HEAVY" if mm < 35.5 else "VERY HEAVY"
    return {
        "city": city,
        "current_mm_hr": live["current_rainfall_mm"],
        "forecast_peak_mm_hr": mm,
        "next_24h_total_mm": live["today_total_mm"],
        "following_24h_total_mm": live["tomorrow_total_mm"],
        "rain_probability": live["rain_probability"],
        "category": category,
        "chart_hours": live["chart_hours"],
        "chart_vals": live["chart_vals"],
        "flood_risk": flood_risk,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
        "source": "Open-Meteo + XGBoost",
    }


@app.get("/yamuna")
def yamuna(city: str = Query("delhi", description="City: delhi / mumbai / sikkim")):
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        df = sikkim_runtime.run_pipeline_for_live(live)
        return sikkim_runtime.water_payload(live, df)
    if city == "mumbai":
        live = _latest_mumbai_conditions()
        flood_risk = _mumbai_predict_payload(
            live["rainfall_mm"],
            live["water_level_m"],
            live["soil_pct"],
        )
        warning_level = 2.8
        danger_level = 3.5
        current_level = live["water_level_m"]
        status = "DANGER" if current_level >= danger_level else "WARNING" if current_level >= warning_level else "NORMAL"
        return {
            "city": city,
            "current_level_m": live["current_water_level_m"],
            "forecast_peak_level_24h_m": current_level,
            "danger_level_m": danger_level,
            "warning_level_m": warning_level,
            "level_change_m": round(current_level - live["current_water_level_m"], 3),
            "discharge_m3s": None,
            "pct_to_danger": round((current_level / danger_level) * 100, 1),
            "status": status,
            "flood_risk": flood_risk,
            "timestamp": live["timestamp"],
            "horizon_hours": PREDICTION_HORIZON_HOURS,
            "forecast_start": live["forecast_start"],
            "forecast_end": live["forecast_end"],
            "source": live["water_level_source"] + " + Mumbai hotspot model",
        }

    live = _get_live_inputs()
    flood_risk = _predict_summary(live)
    return {
        "city": city,
        "current_level_m": live["current_yamuna_level_m"],
        "forecast_peak_level_24h_m": live["yamuna_level_m"],
        "danger_level_m": 205.33,
        "warning_level_m": 204.50,
        "level_change_m": live["yamuna_level_change"],
        "discharge_m3s": live["current_discharge_m3s"],
        "pct_to_danger": round((live["yamuna_level_m"] / 205.33) * 100, 1),
        "status": live["yamuna_status"],
        "flood_risk": flood_risk,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
        "source": "Open-Meteo flood API + XGBoost",
    }


@app.get("/hotspots")
def hotspots(
    risk: str = Query("all", description="Filter: all / critical / high / moderate / low"),
    limit: int = Query(50, description="Max number of hotspots to return"),
    city: str = Query("delhi", description="City: delhi / mumbai / sikkim"),
):
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        results, df = sikkim_runtime.hotspots_payload(live=live, risk=risk, limit=limit)
        return {
            "city": city,
            "count": len(results),
            "total": len(df),
            "filter": risk,
            "timestamp": live["timestamp"],
            "horizon_hours": PREDICTION_HORIZON_HOURS,
            "forecast_start": live["forecast_start"],
            "forecast_end": live["forecast_end"],
            "hotspots": results,
        }
    if city == "mumbai":
        live = _latest_mumbai_conditions()
        results = _mumbai_hotspots(limit, risk)
        total = len(_mumbai_hotspots(len(MUMBAI_HOTSPOTS), risk))
        return {
            "city": city,
            "count": len(results),
            "total": total,
            "filter": risk,
            "timestamp": live["timestamp"],
            "horizon_hours": PREDICTION_HORIZON_HOURS,
            "forecast_start": live["forecast_start"],
            "forecast_end": live["forecast_end"],
            "hotspots": results,
        }

    live = _get_live_inputs()
    results = _delhi_hotspots(live, len(DELHI_HOTSPOTS), risk)
    diversified = results[:limit]
    return {
        "city": city,
        "count": len(diversified),
        "total": len(results),
        "filter": risk,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
        "hotspots": diversified,
    }


@app.get("/wards")
def wards(
    district: str = Query("all", description="Filter by district name"),
    risk: str = Query("all", description="Filter: all / critical / moderate / good"),
    city: str = Query("delhi", description="City: delhi / mumbai / sikkim"),
):
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        df = sikkim_runtime.run_pipeline_for_live(live)
        rows = sikkim_runtime.wards_payload(df)
    elif city == "mumbai":
        live = _latest_mumbai_conditions()
        rows = _mumbai_wards()
    else:
        live = _get_live_inputs()
        rows = _delhi_wards(live)
    if district != "all":
        rows = [row for row in rows if row["district"].lower() == district.lower()]
    if risk != "all":
        wanted = risk.upper()
        risk_map = {"CRITICAL": "CRITICAL", "MODERATE": "MODERATE", "GOOD": "GOOD"}
        rows = [row for row in rows if row["readiness_level"] == risk_map.get(wanted, wanted)]
    return {
        "city": city,
        "count": len(rows),
        "wards": rows,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
    }


@app.get("/alerts")
def alerts(city: str = Query("delhi", description="City: delhi / mumbai / sikkim")):
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        df = sikkim_runtime.run_pipeline_for_live(live)
        return sikkim_runtime.alerts_payload(live, df)
    if city == "mumbai":
        live = _latest_mumbai_conditions()
        city_pred = _mumbai_predict_payload(
            live["rainfall_mm"],
            live["water_level_m"],
            live["soil_pct"],
        )
        hotspot_rows = _mumbai_hotspots(10, "all")
        active_alerts = []
        if live["water_level_m"] >= 3.5:
            active_alerts.append({
                "severity": "RED",
                "type": "WATER_LEVEL_DANGER",
                "message": f"Mumbai water level is forecast to reach {live['water_level_m']}m in the next 24 hours, above danger level.",
                "districts": sorted({row["district"] for row in hotspot_rows[:5]}),
            })
        if live["rainfall_mm"] >= 35.5:
            active_alerts.append({
                "severity": "RED",
                "type": "HEAVY_RAINFALL",
                "message": f"Mumbai rainfall could peak near {live['rainfall_mm']:.1f}mm/hr in the next 24 hours. Urban flooding likely.",
                "districts": sorted({row["district"] for row in hotspot_rows[:8]}),
            })
        if city_pred["flood_probability"] >= 0.25:
            sev = "ORANGE" if city_pred["risk_level"] in ["HIGH", "CRITICAL"] else "YELLOW"
            active_alerts.append({
                "severity": sev,
                "type": "MODEL_ALERT",
                "message": f"Model flood probability for the next 24 hours is {round(city_pred['flood_probability'] * 100)}% for Mumbai.",
                "districts": sorted({row["district"] for row in hotspot_rows[:10]}),
            })
        if not active_alerts:
            active_alerts.append({
                "severity": "GREEN",
                "type": "NORMAL",
                "message": "Next 24-hour Mumbai flood risk remains below alert thresholds.",
                "districts": [],
            })
        return {
            "city": city,
            "alert_count": len(active_alerts),
            "flood_probability": city_pred["flood_probability"],
            "risk_level": city_pred["risk_level"],
            "alerts": active_alerts,
            "timestamp": live["timestamp"],
            "horizon_hours": PREDICTION_HORIZON_HOURS,
        }

    live = _get_live_inputs()
    city_pred = _predict_summary(live)
    cell_results = _delhi_hotspots(live, 10, "all")

    active_alerts = []
    if live["yamuna_level_m"] >= 205.33:
        active_alerts.append({
            "severity": "RED",
            "type": "FLOOD_IMMINENT",
            "message": f"Yamuna is forecast to reach {live['yamuna_level_m']}m in the next 24 hours, above danger level.",
            "districts": sorted({row["district"] for row in cell_results[:5]}),
        })
    if live["rainfall_mm"] >= 35.5:
        active_alerts.append({
            "severity": "RED",
            "type": "HEAVY_RAINFALL",
            "message": f"Rainfall could peak near {live['rainfall_mm']:.1f}mm/hr in the next 24 hours. Urban flooding likely.",
            "districts": sorted({row["district"] for row in cell_results[:8]}),
        })
    if city_pred["flood_probability"] >= 0.25:
        sev = "ORANGE" if city_pred["risk_level"] in ["HIGH", "CRITICAL"] else "YELLOW"
        active_alerts.append({
            "severity": sev,
            "type": "MODEL_ALERT",
            "message": f"Model flood probability for the next 24 hours is {round(city_pred['flood_probability'] * 100)}% for Delhi.",
            "districts": sorted({row["district"] for row in cell_results[:10]}),
        })
    if not active_alerts:
        active_alerts.append({
            "severity": "GREEN",
            "type": "NORMAL",
            "message": "Next 24-hour Delhi flood risk remains below alert thresholds.",
            "districts": [],
        })

    return {
        "city": city,
        "alert_count": len(active_alerts),
        "flood_probability": city_pred["flood_probability"],
        "risk_level": city_pred["risk_level"],
        "alerts": active_alerts,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
    }


class SimulateRequest(BaseModel):
    rainfall_mm: float = 25.0
    duration_hr: float = 3.0
    yamuna_level: float = 204.0
    soil_saturation: float = 60.0
    drain_condition: float = 0.6
    city: str = "delhi"


class AssistantTurn(BaseModel):
    role: str = "user"
    content: str = ""


class AssistantChatRequest(BaseModel):
    city: str = "delhi"
    message: str = ""
    history: list[AssistantTurn] = Field(default_factory=list)


def _format_window_point(value: str) -> str:
    try:
        return datetime.fromisoformat(value).strftime("%d %b %H:%M IST")
    except Exception:
        return value or "-"


def _assistant_context(city: str) -> dict:
    city = _normalise_city(city)
    if city == "sikkim":
        live = sikkim_runtime.get_live_inputs()
        df = sikkim_runtime.run_pipeline_for_live(live)
        hotspots_all, _ = sikkim_runtime.hotspots_payload(live=live, risk="all", limit=len(df))
        wards_all = sikkim_runtime.wards_payload(df)
        rain = sikkim_runtime.rainfall_payload(live, df)
        water = sikkim_runtime.water_payload(live, df)
        alert_payload = sikkim_runtime.alerts_payload(live, df)
        prediction = sikkim_runtime.predict_summary(live, df)
        return {
            "city": city,
            "city_label": "Sikkim",
            "agency": "SSDMA",
            "water_body": "Teesta River",
            "live": live,
            "prediction": prediction,
            "hotspots": hotspots_all,
            "wards": wards_all,
            "rain": rain,
            "water": water,
            "alerts": alert_payload["alerts"],
            "forecast_start": live["forecast_start"],
            "forecast_end": live["forecast_end"],
            "hotspot_source": "SFIS v4 live run using RF25/SRTM/Rivers assets",
        }
    if city == "mumbai":
        live = _latest_mumbai_conditions()
        prediction = _mumbai_predict_payload(
            live["rainfall_mm"],
            live["water_level_m"],
            live["soil_pct"],
        )
        hotspots_all = _mumbai_hotspots(len(MUMBAI_HOTSPOTS), "all")
        wards_all = _mumbai_wards()
        rain = rainfall(city)
        water = yamuna(city)
        alert_payload = alerts(city)
        return {
            "city": city,
            "city_label": "Mumbai",
            "agency": "BMC",
            "water_body": "Arabian Sea",
            "live": live,
            "prediction": prediction,
            "hotspots": hotspots_all,
            "wards": wards_all,
            "rain": rain,
            "water": water,
            "alerts": alert_payload["alerts"],
            "forecast_start": live["forecast_start"],
            "forecast_end": live["forecast_end"],
            "hotspot_source": "mumbai_flood_hotspots.json + mumbai_flood_dataset.csv",
        }

    live = _get_live_inputs()
    prediction = _predict_summary(live)
    hotspots_all = _delhi_hotspots(live, len(DELHI_HOTSPOTS), "all")
    wards_all = _delhi_wards(live)
    rain = rainfall(city)
    water = yamuna(city)
    alert_payload = alerts(city)
    return {
        "city": city,
        "city_label": "Delhi",
        "agency": "DDMA",
        "water_body": "Yamuna",
        "live": live,
        "prediction": prediction,
        "hotspots": hotspots_all,
        "wards": wards_all,
        "rain": rain,
        "water": water,
        "alerts": alert_payload["alerts"],
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
        "hotspot_source": "hotspots_570.json re-scored with live Delhi model inputs",
    }


def _assistant_priority_hotspots(context: dict, message: str) -> list:
    hotspots = context["hotspots"]
    if not hotspots:
        return []
    text = (message or "").lower()
    if not text:
        return hotspots[:5]
    matches = []
    for hotspot in hotspots:
        district = str(hotspot.get("district", "")).lower()
        name = str(hotspot.get("name", "")).lower()
        if district and district in text:
            matches.append(hotspot)
        elif name and name in text:
            matches.append(hotspot)
    return (matches or hotspots)[:5]


def _assistant_priority_wards(context: dict, message: str) -> list:
    wards = sorted(context["wards"], key=lambda item: item["readiness_score"])
    if not wards:
        return []
    text = (message or "").lower()
    if not text:
        return wards[:4]
    matches = []
    for ward in wards:
        ward_name = str(ward.get("ward", "")).lower()
        district = str(ward.get("district", "")).lower()
        if ward_name and ward_name in text:
            matches.append(ward)
        elif district and district in text:
            matches.append(ward)
    return (matches or wards)[:4]


def _assistant_grounding(context: dict, message: str, history: list[AssistantTurn]) -> dict:
    hotspots_focus = _assistant_priority_hotspots(context, message)
    weak_wards = _assistant_priority_wards(context, message)
    recent_history = []
    for turn in history[-8:]:
        content = (turn.content or "").strip()
        if content:
            recent_history.append({"role": turn.role, "content": content})

    return {
        "city": context["city"],
        "city_label": context["city_label"],
        "agency": context["agency"],
        "water_body": context["water_body"],
        "question": (message or "").strip(),
        "conversation_history": recent_history,
        "forecast_window": {
            "start": context["forecast_start"],
            "end": context["forecast_end"],
            "start_label": _format_window_point(context["forecast_start"]),
            "end_label": _format_window_point(context["forecast_end"]),
            "horizon_hours": PREDICTION_HORIZON_HOURS,
        },
        "prediction": context["prediction"],
        "rainfall": context["rain"],
        "water": context["water"],
        "alerts": context["alerts"][:5],
        "top_hotspots": hotspots_focus[:5],
        "weakest_readiness_units": weak_wards[:4],
        "summary_counts": {
            "total_hotspots": len(context["hotspots"]),
            "critical_hotspots": len([row for row in context["hotspots"] if row["risk_level"] == "CRITICAL"]),
            "elevated_hotspots": len([row for row in context["hotspots"] if row["risk_level"] in ["HIGH", "MODERATE"]]),
            "ward_count": len(context["wards"]),
        },
        "sources": {
            "hotspots": context["hotspot_source"],
            "rainfall": context["rain"].get("source"),
            "water": context["water"].get("source"),
        },
    }


def _assistant_needs_grounding(message: str) -> bool:
    text = (message or "").strip().lower()
    if not text:
        return False
    keywords = [
        "flood", "flooding", "rain", "rainfall", "yamuna", "water", "river", "level",
        "forecast", "hotspot", "hotspots", "alert", "alerts", "warning", "evacuation",
        "evacuate", "deploy", "deployment", "readiness", "ward", "district", "officer",
        "officers", "rescue", "drain", "drainage", "weather", "delhi", "mumbai", "sikkim", "teesta", "glof", "landslide",
        "route", "shelter", "precaution", "precautions", "disaster",
    ]
    return any(word in text for word in keywords)


def _assistant_schema() -> dict:
    return {
        "name": "flood_assistant_response",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "answer": {"type": "string"},
                "situation": {"type": "array", "items": {"type": "string"}},
                "actions": {"type": "array", "items": {"type": "string"}},
                "watch_points": {"type": "array", "items": {"type": "string"}},
                "suggestions": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["answer", "situation", "actions", "watch_points", "suggestions"],
        },
        "strict": True,
    }


def _assistant_stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts = [_assistant_stringify(item) for item in value]
        return "; ".join(part for part in parts if part)
    if isinstance(value, dict):
        for key in ["text", "answer", "title", "label", "message", "content", "value"]:
            text = _assistant_stringify(value.get(key))
            if text:
                return text
        parts = [_assistant_stringify(item) for item in value.values()]
        return "; ".join(part for part in parts if part)
    return str(value).strip()


def _assistant_string_list(value, fallback: list[str] | None = None) -> list[str]:
    items = []
    if isinstance(value, list):
        items = [_assistant_stringify(item) for item in value]
    elif value is not None:
        text = _assistant_stringify(value)
        if text:
            items = [segment.strip() for segment in text.replace("\r", "\n").split("\n")]
    items = [item for item in items if item]
    if items:
        return items[:5]
    return (fallback or [])[:5]


def _assistant_gemini_text(response_payload: dict) -> str:
    for candidate in response_payload.get("candidates", []):
        content = candidate.get("content", {})
        for part in content.get("parts", []):
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return text
    return ""


def _assistant_llm_response(context: dict, message: str, history: list[AssistantTurn]) -> dict:
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY is not set. Configure it before using /assistant/chat.",
        )

    use_grounding = _assistant_needs_grounding(message)
    grounding = _assistant_grounding(context, message, history) if use_grounding else None
    recent_history = []
    for turn in history[-8:]:
        content = (turn.content or "").strip()
        if content:
            recent_history.append({"role": turn.role, "content": content})
    developer_prompt = (
        "You are a normal conversational chatbot inside a flood intelligence dashboard. "
        "For general questions, chat naturally and answer like a normal assistant. "
        "Only use flood/dashboard grounding when the user's question is actually about flood risk, weather, hotspots, alerts, readiness, deployment, evacuation, or dashboard operations. "
        "When grounded flood data is provided, use it carefully and do not invent facts, numbers, locations, alerts, or thresholds. "
        "When no flood grounding is provided, do not mention flood data at all. "
        "Do not force every answer into an operational briefing. "
        "Use conversation history when helpful so follow-up questions feel natural. "
        "Keep the answer conversational and helpful, not robotic. "
        "Return JSON with keys answer, situation, actions, watch_points, suggestions. "
        "For general chat, keep situation/actions/watch_points empty and suggestions optional."
    )
    user_prompt = "User question:\n" + ((message or "").strip() or "Hello") + "\n\n"
    if recent_history:
        user_prompt += "Conversation history:\n" + json.dumps(recent_history, ensure_ascii=True) + "\n\n"
    if grounding:
        user_prompt += "Grounding data for this flood/dashboard question:\n" + json.dumps(grounding, ensure_ascii=True) + "\n\n"
    else:
        user_prompt += "No flood/dashboard grounding is needed for this question. Answer normally.\n\n"
    user_prompt += "Return a JSON object with keys: answer, situation, actions, watch_points, suggestions."
    body = {
        "system_instruction": {
            "parts": [{"text": developer_prompt}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
        },
    }

    request = urllib.request.Request(
        GEMINI_BASE_URL + "/models/" + urllib.parse.quote(GEMINI_MODEL, safe="") + ":generateContent?key=" + urllib.parse.quote(GEMINI_API_KEY, safe=""),
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=GEMINI_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise HTTPException(status_code=502, detail=f"Gemini API error: {detail or exc.reason}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Assistant model request failed: {exc}") from exc

    text = _assistant_gemini_text(payload)
    if not text.strip():
        raise HTTPException(status_code=502, detail="Assistant model returned an empty response.")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Assistant model returned invalid JSON.") from exc

    default_suggestions = [
        "What should officers do first in the top hotspot?",
        "Do we need evacuation or only field deployment?",
        "Explain the current flood risk in simple words.",
    ]

    return {
        "answer": _assistant_stringify(parsed.get("answer")) or "I could not generate a grounded assistant reply.",
        "situation": _assistant_string_list(parsed.get("situation")),
        "actions": _assistant_string_list(parsed.get("actions")),
        "watch_points": _assistant_string_list(parsed.get("watch_points")),
        "suggestions": _assistant_string_list(parsed.get("suggestions"), default_suggestions),
        "grounding": grounding or {"weakest_readiness_units": []},
    }


@app.post("/assistant/chat")
def assistant_chat(req: AssistantChatRequest):
    city = _normalise_city(req.city)
    context = _assistant_context(city)
    query_text = (req.message or "").strip()
    if len(query_text.split()) < 4 and req.history:
        previous_user = next(
            (turn.content for turn in reversed(req.history) if turn.role == "user" and turn.content.strip()),
            "",
        )
        if previous_user:
            query_text = previous_user + " " + query_text

    model_reply = _assistant_llm_response(context, query_text, req.history)

    return {
        "city": city,
        "focus": "llm_grounded_prediction_chat",
        "timestamp": datetime.now().isoformat(),
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": context["forecast_start"],
        "forecast_end": context["forecast_end"],
        "answer": model_reply["answer"],
        "situation": model_reply["situation"],
        "actions": model_reply["actions"],
        "watch_points": model_reply["watch_points"],
        "suggestions": model_reply["suggestions"],
        "sources": [
            f"Rainfall: {context['rain']['source']}",
            f"Water levels: {context['water']['source']}",
            f"Hotspots: {context['hotspot_source']}",
            "Readiness: calculated from current hotspot and operational component data",
        ],
        "metrics": {
            "flood_probability": context["prediction"]["flood_probability"],
            "risk_level": context["prediction"]["risk_level"],
            "forecast_peak_rainfall_mmhr": context["rain"]["forecast_peak_mm_hr"],
            "forecast_total_rainfall_mm": context["rain"]["next_24h_total_mm"],
            "current_water_level_m": context["water"]["current_level_m"],
            "forecast_peak_water_level_m": context["water"]["forecast_peak_level_24h_m"],
            "critical_hotspots": len([row for row in context["hotspots"] if row["risk_level"] == "CRITICAL"]),
            "weakest_readiness_score": model_reply["grounding"]["weakest_readiness_units"][0]["readiness_score"] if model_reply["grounding"]["weakest_readiness_units"] else None,
        },
    }


@app.post("/simulate")
def simulate(req: SimulateRequest):
    city = _normalise_city(req.city)
    if city == "sikkim":
        return sikkim_runtime.simulate_payload(
            rainfall_mm=req.rainfall_mm,
            duration_hr=req.duration_hr,
            water_level=req.yamuna_level,
            soil_pct=req.soil_saturation,
            drain_condition=req.drain_condition,
        )
    drain_condition = _clamp(req.drain_condition, 0.05, 1.0)
    duration_hr = max(1.0, float(req.duration_hr))

    if city == "mumbai":
        base_live = _latest_mumbai_conditions()
        rain_load = 1.0 + (1.0 - drain_condition) * 0.22
        rain_total = round(req.rainfall_mm * duration_hr * rain_load, 2)
        forecast_water_level = round(
            req.yamuna_level + (rain_total / 180.0) * (0.22 + (1.0 - drain_condition) * 0.18),
            2,
        )
        soil_pct = round(min(100.0, req.soil_saturation + duration_hr * 1.8 + (1.0 - drain_condition) * 10.0), 2)
        live = dict(base_live)
        live.update({
            "timestamp": datetime.now().isoformat(),
            "current_rainfall_mm": round(req.rainfall_mm, 2),
            "rainfall_mm": round(req.rainfall_mm, 2),
            "today_total_mm": rain_total,
            "tomorrow_total_mm": round(rain_total * 0.55, 2),
            "soil_pct": soil_pct,
            "current_water_level_m": round(req.yamuna_level, 2),
            "water_level_m": forecast_water_level,
            "temperature_c": base_live.get("temperature_c"),
            "humidity_pct": base_live.get("humidity_pct"),
            "wind_kmh": base_live.get("wind_kmh"),
        })
        prediction = _mumbai_predict_payload(rain_total, forecast_water_level, soil_pct)
        hotspot_rows = _mumbai_hotspots_for_live(live, len(MUMBAI_HOTSPOTS), "all")
        affected = [row for row in hotspot_rows if row["probability"] >= 0.5]
        high_risk = [row for row in hotspot_rows if row["risk_level"] in ["HIGH", "CRITICAL"]]
        return {
            "scenario": req.model_dump(),
            "prediction": prediction,
            "impact_estimate": {
                "affected_cells": len(affected),
                "high_risk_cells": len(high_risk),
                "top_hotspots": hotspot_rows[:10],
            },
            "timestamp": datetime.now().isoformat(),
        }

    base_live = _get_live_inputs()
    rain_load = 1.0 + (1.0 - drain_condition) * 0.28
    live = dict(base_live)
    live["timestamp"] = datetime.now().isoformat()
    live["rainfall_mm"] = round(req.rainfall_mm, 2)
    live["today_total_mm"] = round(req.rainfall_mm * duration_hr * rain_load, 2)
    live["tomorrow_total_mm"] = round(live["today_total_mm"] * 0.6, 2)
    forecast_level = round(
        req.yamuna_level + (live["today_total_mm"] / 220.0) * (0.35 + (1.0 - drain_condition) * 0.30),
        2,
    )
    live["yamuna_level_change"] = round(forecast_level - req.yamuna_level, 2)
    live["yamuna_level_m"] = forecast_level
    live["discharge_m3s"] = max(0.0, (forecast_level - 200.0) * 1350.0)
    live["soil_pct"] = round(min(100.0, req.soil_saturation + duration_hr * 3.4 + (1.0 - drain_condition) * 14.0), 2)

    cell_results = _compute_all_cells(live)
    city_pred = _predict_summary(live)
    affected = [row for row in cell_results if row["probability"] >= THRESHOLD]

    return {
        "scenario": req.model_dump(),
        "prediction": city_pred,
        "impact_estimate": {
            "affected_cells": len(affected),
            "high_risk_cells": len([row for row in cell_results if row["risk_level"] in ["HIGH", "CRITICAL"]]),
            "top_hotspots": cell_results[:10],
        },
        "timestamp": datetime.now().isoformat(),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=8000, reload=False)
