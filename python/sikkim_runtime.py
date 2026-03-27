"""
Sikkim runtime integration for Dhristi.

This module adapts the provided SFIS model/assets into the same data contract
used by the Delhi and Mumbai API endpoints.
"""

from __future__ import annotations

import importlib.util
import math
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import pandas as pd


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.normpath(os.path.join(BASE_DIR, ".."))
SIKKIM_DIR = os.path.join(ROOT_DIR, "data", "sikkim")
SIKKIM_SCRIPT_PATH = os.path.join(SIKKIM_DIR, "sikkim_flood_model.py")
SIKKIM_OUTPUT_DIR = os.path.join(SIKKIM_DIR, "output")
SIKKIM_PREDICTIONS_PATH = os.path.join(SIKKIM_OUTPUT_DIR, "sikkim_predictions.csv")
SIKKIM_MODEL_PATH = os.path.join(SIKKIM_OUTPUT_DIR, "sikkim_flood_model.pkl")
LIVE_TTL_SECONDS = 300
PIPELINE_TTL_SECONDS = 900
PREDICTION_HORIZON_HOURS = 24

_MODULE_CACHE = None
_PROFILE_CACHE = None
_LIVE_CACHE = {"ts": 0.0, "data": None}
_PIPELINE_CACHE = {"ts": 0.0, "key": None, "data": None}


def _fetch_json(base_url: str, params: dict) -> dict:
    url = base_url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20) as resp:
        import json
        return json.loads(resp.read().decode("utf-8"))


def _window_meta() -> tuple[str, str]:
    start = datetime.now().replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=PREDICTION_HORIZON_HOURS)
    return start.isoformat(), end.isoformat()


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _load_module():
    global _MODULE_CACHE
    if _MODULE_CACHE is not None:
        return _MODULE_CACHE
    spec = importlib.util.spec_from_file_location("sikkim_model_runtime", SIKKIM_SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    if spec.loader is None:
        raise RuntimeError("Unable to load Sikkim model script")
    spec.loader.exec_module(module)
    _MODULE_CACHE = module
    return module


def _baseline_df() -> pd.DataFrame:
    df = pd.read_csv(SIKKIM_PREDICTIONS_PATH)
    for col in ["lat", "lon", "elevation_m", "risk_score", "probability", "local_water_level_m", "local_rainfall_mm", "local_soil_moisture", "teesta_prox", "glof_risk", "flood_eta_hours"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _footprint_area_km2(df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    lat_span = float(df["lat"].max() - df["lat"].min())
    lon_span = float(df["lon"].max() - df["lon"].min())
    mean_lat = float(df["lat"].mean())
    height_km = lat_span * 111.0
    width_km = lon_span * 111.0 * math.cos(math.radians(mean_lat))
    return max(1, int(round(height_km * width_km)))


def load_profile(force_refresh: bool = False) -> dict:
    global _PROFILE_CACHE
    if _PROFILE_CACHE is not None and not force_refresh:
        return _PROFILE_CACHE

    df = _baseline_df()
    if df.empty:
        raise RuntimeError("Sikkim predictions CSV is empty")

    dominant = df.sort_values(["teesta_prox", "risk_score"], ascending=[False, False]).iloc[0]
    profile = {
        "key": "sikkim",
        "label": "Sikkim",
        "full_name": "Sikkim",
        "agency": "SSDMA",
        "river_label": "Teesta",
        "water_body_label": "Teesta River",
        "station_label": "Teesta basin live weather",
        "lat": round(float(df["lat"].mean()), 4),
        "lon": round(float(df["lon"].mean()), 4),
        "zoom": 9,
        "area_km2": _footprint_area_km2(df),
        "districts": int(df["district"].nunique()),
        "wards": int(len(df)),
        "grid_cells": int(len(df)),
        "gauge_name": str(dominant["location"]),
        "gauge_lat": round(float(dominant["lat"]), 4),
        "gauge_lon": round(float(dominant["lon"]), 4),
        "bounds": {
            "south": round(float(df["lat"].min()), 4),
            "north": round(float(df["lat"].max()), 4),
            "west": round(float(df["lon"].min()), 4),
            "east": round(float(df["lon"].max()), 4),
        },
        "sources": {
            "predictions": SIKKIM_PREDICTIONS_PATH,
            "model": SIKKIM_MODEL_PATH,
            "script": SIKKIM_SCRIPT_PATH,
        },
    }
    _PROFILE_CACHE = profile
    return profile


def _forecast_index(hourly_times: list, current_time_iso: str | None) -> int:
    if current_time_iso and current_time_iso in hourly_times:
        return hourly_times.index(current_time_iso)
    return 0


def _sum_window(values: list, start: int, width: int) -> float:
    end = min(len(values), start + width)
    return round(sum(float(values[i] or 0.0) for i in range(start, end)), 1)


def _max_window(values: list, start: int, width: int) -> float:
    end = min(len(values), start + width)
    window = [float(values[i] or 0.0) for i in range(start, end)]
    return round(max(window) if window else 0.0, 1)


def get_live_inputs(force_refresh: bool = False) -> dict:
    now = time.time()
    if not force_refresh and _LIVE_CACHE["data"] and now - _LIVE_CACHE["ts"] < LIVE_TTL_SECONDS:
        return _LIVE_CACHE["data"]

    profile = load_profile()
    weather = _fetch_json(
        "https://api.open-meteo.com/v1/forecast",
        {
            "latitude": profile["lat"],
            "longitude": profile["lon"],
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
            "latitude": profile["gauge_lat"],
            "longitude": profile["gauge_lon"],
            "daily": "river_discharge",
            "forecast_days": 3,
        },
    )

    current = weather.get("current", {})
    hourly = weather.get("hourly", {})
    daily = weather.get("daily", {})
    flood_daily = flood.get("daily", {})

    hourly_times = hourly.get("time") or []
    current_idx = _forecast_index(hourly_times, current.get("time"))
    hourly_precip = hourly.get("precipitation") or []
    hourly_soil = hourly.get("soil_moisture_0_to_1cm") or []

    current_mm = round(float(current.get("precipitation", 0.0) or 0.0), 1)
    next_24_total = _sum_window(hourly_precip, current_idx, PREDICTION_HORIZON_HOURS)
    next_24_peak = _max_window(hourly_precip, current_idx, PREDICTION_HORIZON_HOURS)
    following_24_total = _sum_window(hourly_precip, current_idx + PREDICTION_HORIZON_HOURS, PREDICTION_HORIZON_HOURS)
    rain_prob = int(max((daily.get("precipitation_probability_max") or [0, 0])[:2] or [0]))
    soil_raw = float(hourly_soil[current_idx] if current_idx < len(hourly_soil) else 0.55)
    soil_pct = round(_clamp(soil_raw * 100.0, 0.0, 100.0), 1)

    discharge_series = flood_daily.get("river_discharge") or [0.0, 0.0, 0.0]
    current_discharge = float(discharge_series[0] or 0.0)
    next_discharge = float(discharge_series[1] or current_discharge)
    forecast_discharge = max(current_discharge, next_discharge)

    # Convert river discharge into a Teesta stage input usable by the SFIS model.
    current_level = round(_clamp(4.0 + current_discharge / 180.0, 2.5, 18.0), 2)
    forecast_level = round(_clamp(4.0 + forecast_discharge / 180.0, 2.5, 18.0), 2)
    warning_level = 9.0
    danger_level = 12.0
    status = "DANGER" if forecast_level >= danger_level else "WARNING" if forecast_level >= warning_level else "NORMAL"
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
        "chart_vals": [round(float(hourly_precip[i] or 0.0), 1) if i < len(hourly_precip) else 0.0 for i in range(current_idx, min(len(hourly_precip), current_idx + PREDICTION_HORIZON_HOURS), 2)],
        "chart_hours": [str(i).zfill(2) for i in range(0, min(PREDICTION_HORIZON_HOURS, 24), 2)],
        "temperature_c": current.get("temperature_2m"),
        "humidity_pct": current.get("relative_humidity_2m"),
        "wind_kmh": current.get("wind_speed_10m"),
        "discharge_m3s": round(forecast_discharge, 2),
        "current_discharge_m3s": round(current_discharge, 2),
        "current_level_m": current_level,
        "water_level_m": forecast_level,
        "water_level_change": round(forecast_level - current_level, 2),
        "water_status": status,
        "warning_level_m": warning_level,
        "danger_level_m": danger_level,
        "water_level_source": "Open-Meteo Flood API (Teesta proxy near " + profile["gauge_name"] + ")",
        "rainfall_source": "Open-Meteo forecast",
        "profile": profile,
    }
    _LIVE_CACHE["ts"] = now
    _LIVE_CACHE["data"] = live
    return live


def _pipeline_key(rainfall_mm: float, water_level_m: float, soil_pct: float, month: int, rain_3day: float, rain_7day: float) -> tuple:
    return (
        round(rainfall_mm, 2),
        round(water_level_m, 2),
        round(soil_pct, 2),
        int(month),
        round(rain_3day, 2),
        round(rain_7day, 2),
    )


def run_pipeline_for_live(live: dict | None = None, force_refresh: bool = False) -> pd.DataFrame:
    now = time.time()
    if live is None:
        live = get_live_inputs(force_refresh=force_refresh)

    month = datetime.now().month
    rain_3day = max(live["today_total_mm"] * 1.6, live["rainfall_mm"] * 3.0)
    rain_7day = max(rain_3day * 2.1, live["today_total_mm"] * 3.4)
    key = _pipeline_key(live["rainfall_mm"], live["water_level_m"], live["soil_pct"], month, rain_3day, rain_7day)
    if (
        not force_refresh
        and _PIPELINE_CACHE["data"] is not None
        and _PIPELINE_CACHE["key"] == key
        and now - _PIPELINE_CACHE["ts"] < PIPELINE_TTL_SECONDS
    ):
        return _PIPELINE_CACHE["data"].copy()

    module = _load_module()
    df = module.run_pipeline(
        rainfall_mm=float(live["rainfall_mm"]),
        water_level_m=float(live["water_level_m"]),
        soil_moisture=float(live["soil_pct"]),
        month=month,
        rain_3day=float(rain_3day),
        rain_7day=float(rain_7day),
        output_dir=SIKKIM_OUTPUT_DIR,
    )
    _PIPELINE_CACHE["ts"] = now
    _PIPELINE_CACHE["key"] = key
    _PIPELINE_CACHE["data"] = df.copy()
    return df


def _risk_meta(prob: float) -> dict:
    if prob >= 0.75:
        return {"level": "CRITICAL", "color": "#DC2626", "code": 4}
    if prob >= 0.50:
        return {"level": "HIGH", "color": "#EA580C", "code": 3}
    if prob >= 0.25:
        return {"level": "MODERATE", "color": "#D97706", "code": 2}
    return {"level": "LOW", "color": "#16A34A", "code": 1}


def predict_summary(live: dict | None = None, df: pd.DataFrame | None = None) -> dict:
    if live is None:
        live = get_live_inputs()
    if df is None:
        df = run_pipeline_for_live(live)

    top_n = min(12, len(df)) or 1
    hotspot_mean = float(df["probability"].head(top_n).mean()) if len(df) else 0.0
    city_prob = round(_clamp(hotspot_mean * 0.78 + float(df["probability"].max()) * 0.22, 0.0, 1.0), 4) if len(df) else 0.0
    risk = _risk_meta(city_prob)
    return {
        "flood_probability": city_prob,
        "flood_predicted": int(city_prob >= 0.45),
        "risk_level": risk["level"],
        "risk_color": risk["color"],
        "risk_code": risk["code"],
        "threshold_used": 0.45,
        "model": "sfis_v4",
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
        "basis": "next_24h_live_forecast",
    }


def hotspots_payload(live: dict | None = None, risk: str = "all", limit: int = 50) -> tuple[list[dict], pd.DataFrame]:
    if live is None:
        live = get_live_inputs()
    df = run_pipeline_for_live(live)
    rows = df.copy()

    risk_filter = (risk or "all").strip().lower()
    if risk_filter == "moderate":
        risk_filter = "medium"
    if risk_filter != "all":
        rows = rows[rows["risk_class"].str.lower() == risk_filter]
    rows = rows.sort_values(["probability", "risk_score"], ascending=[False, False]).head(limit)

    output = []
    for _, row in rows.iterrows():
        risk_meta = _risk_meta(float(row["probability"]))
        output.append({
            "cell_id": str(row["location"]),
            "name": str(row["location"]),
            "lat": round(float(row["lat"]), 6),
            "lon": round(float(row["lon"]), 6),
            "district": str(row["district"]),
            "probability": round(float(row["probability"]), 4),
            "risk_level": risk_meta["level"],
            "risk_color": risk_meta["color"],
            "risk_code": risk_meta["code"],
            "risk_score": round(float(row["risk_score"]), 1),
            "cause": str(row["risk_type"]).replace("_", " "),
            "elevation_m": round(float(row["elevation_m"]), 2),
            "slope_deg": 0.0,
            "flow_accumulation": round(float(row["teesta_prox"]) * 100.0, 2),
            "drain_capacity_pct": round(_clamp(100.0 - float(row["teesta_prox"]) * 55.0, 20.0, 100.0), 1),
            "impervious_pct": round(_clamp(25.0 + float(row["glof_risk"]) * 55.0, 10.0, 95.0), 1),
            "yamuna_proximity_m": round((1.0 - float(row["teesta_prox"])) * 10000.0, 1),
            "eta_hours": None if pd.isna(row["flood_eta_hours"]) else int(row["flood_eta_hours"]),
            "lead_time_confidence": None if pd.isna(row["lead_time_confidence"]) else str(row["lead_time_confidence"]),
            "source": "SFIS live pipeline",
            "recommended_action": str(row["advice"]),
            "risk_type": str(row["risk_type"]),
        })
    return output, df


def wards_payload(df: pd.DataFrame | None = None) -> list[dict]:
    if df is None:
        df = run_pipeline_for_live()
    grouped = df.groupby("district", dropna=False)
    rows = []
    for district, group in grouped:
        avg_prob = float(group["probability"].mean())
        avg_score = float(group["risk_score"].mean())
        avg_teesta = float(group["teesta_prox"].mean())
        avg_glof = float(group["glof_risk"].mean())
        avg_eta = float(group["flood_eta_hours"].fillna(group["flood_eta_hours"].median()).mean()) if "flood_eta_hours" in group else 8.0

        drainage = round(_clamp(100.0 - avg_teesta * 45.0, 18.0, 100.0), 1)
        pumps = round(_clamp(100.0 - avg_prob * 62.0, 10.0, 100.0), 1)
        roads = round(_clamp(100.0 - avg_glof * 48.0 - avg_teesta * 18.0, 8.0, 100.0), 1)
        emergency = round(_clamp(100.0 - avg_score * 0.72 + avg_eta * 1.4, 5.0, 100.0), 1)
        preparedness = round(_clamp(100.0 - avg_score * 0.55, 8.0, 100.0), 1)
        readiness = round(drainage * 0.30 + pumps * 0.25 + roads * 0.20 + emergency * 0.15 + preparedness * 0.10, 1)
        if readiness < 40:
            level = "CRITICAL"
        elif readiness < 70:
            level = "MODERATE"
        else:
            level = "GOOD"

        rows.append({
            "ward": str(district),
            "district": str(district),
            "readiness_score": readiness,
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


def rainfall_payload(live: dict | None = None, df: pd.DataFrame | None = None) -> dict:
    if live is None:
        live = get_live_inputs()
    if df is None:
        df = run_pipeline_for_live(live)
    flood_risk = predict_summary(live, df)
    mm = float(live["rainfall_mm"])
    category = "LIGHT" if mm < 2.5 else "MODERATE" if mm < 7.6 else "HEAVY" if mm < 35.5 else "VERY HEAVY"
    return {
        "city": "sikkim",
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
        "source": live["rainfall_source"] + " + SFIS RF25-driven model",
    }


def water_payload(live: dict | None = None, df: pd.DataFrame | None = None) -> dict:
    if live is None:
        live = get_live_inputs()
    if df is None:
        df = run_pipeline_for_live(live)
    flood_risk = predict_summary(live, df)
    return {
        "city": "sikkim",
        "current_level_m": live["current_level_m"],
        "forecast_peak_level_24h_m": live["water_level_m"],
        "danger_level_m": live["danger_level_m"],
        "warning_level_m": live["warning_level_m"],
        "level_change_m": live["water_level_change"],
        "discharge_m3s": live["current_discharge_m3s"],
        "pct_to_danger": round((live["water_level_m"] / live["danger_level_m"]) * 100.0, 1),
        "status": live["water_status"],
        "flood_risk": flood_risk,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
        "forecast_start": live["forecast_start"],
        "forecast_end": live["forecast_end"],
        "source": live["water_level_source"] + " + SFIS Teesta stage mapping",
        "station_name": live["profile"]["gauge_name"],
    }


def status_payload(live: dict | None = None, df: pd.DataFrame | None = None) -> dict:
    if live is None:
        live = get_live_inputs()
    if df is None:
        df = run_pipeline_for_live(live)
    profile = live["profile"]
    city_pred = predict_summary(live, df)
    return {
        "status": "online",
        "city": "sikkim",
        "timestamp": datetime.now().isoformat(),
        "model_version": "sfis_v4",
        "trained_on": "SFIS generated terrain-hydrology training set + provided Sikkim assets",
        "train_years": "model-generated scenario training with RF25/SRTM/Rivers inputs",
        "total_rows": int(len(df)),
        "metrics": {
            "auc_roc": None,
            "threshold": 0.45,
            "prediction_horizon_hours": PREDICTION_HORIZON_HOURS,
        },
        "n_features": 24,
        "features": [
            "rainfall_mm", "water_level_m", "soil_moisture_pct", "elevation_m", "slope_deg",
            "month", "day_of_year", "is_monsoon", "is_peak_monsoon",
            "rainfall_zscore", "extreme_rainfall", "heavy_rainfall",
            "saturation_index", "overflow_risk", "landslide_risk",
            "glof_risk", "elev_risk", "teesta_proximity",
            "teesta_flood_risk", "landslide_flood_risk",
            "rain_3day", "rain_7day", "antecedent_ratio", "compound_risk",
        ],
        "grid_cells": int(len(df)),
        "live_inputs": live,
        "city_prediction": city_pred,
        "prediction_basis": "next_24h_live_forecast",
        "city_profile": profile,
    }


def alerts_payload(live: dict | None = None, df: pd.DataFrame | None = None) -> dict:
    if live is None:
        live = get_live_inputs()
    hotspots, full_df = hotspots_payload(live=live, risk="all", limit=10)
    if df is None:
        df = full_df
    city_pred = predict_summary(live, df)

    active_alerts = []
    top_districts = sorted({row["district"] for row in hotspots[:8]})
    if live["water_level_m"] >= live["danger_level_m"]:
        active_alerts.append({
            "severity": "RED",
            "type": "TEESTA_DANGER",
            "message": f"Teesta is forecast to reach {live['water_level_m']}m in the next 24 hours, above danger level near {live['profile']['gauge_name']}.",
            "districts": top_districts[:5],
        })
    if live["rainfall_mm"] >= 35.5:
        active_alerts.append({
            "severity": "RED",
            "type": "HEAVY_RAINFALL",
            "message": f"Sikkim rainfall could peak near {live['rainfall_mm']:.1f}mm/hr in the next 24 hours with rapid runoff potential.",
            "districts": top_districts[:8],
        })
    if int((df["risk_type"] == "glof_source").sum()) > 0 and float(df[df["risk_type"] == "glof_source"]["probability"].max()) >= 0.45:
        active_alerts.append({
            "severity": "ORANGE",
            "type": "GLOF_WATCH",
            "message": "Glacial-source corridors are elevated in the next 24-hour SFIS run. Monitor upper Teesta and downstream propagation windows.",
            "districts": sorted({str(v) for v in df[df["risk_type"].isin(["glof_source", "glof_risk", "glof_landslide"])]["district"].head(6)}),
        })
    if city_pred["flood_probability"] >= 0.25:
        sev = "ORANGE" if city_pred["risk_level"] in ["HIGH", "CRITICAL"] else "YELLOW"
        active_alerts.append({
            "severity": sev,
            "type": "MODEL_ALERT",
            "message": f"Model flood probability for the next 24 hours is {round(city_pred['flood_probability'] * 100)}% for Sikkim.",
            "districts": top_districts[:10],
        })
    if not active_alerts:
        active_alerts.append({
            "severity": "GREEN",
            "type": "NORMAL",
            "message": "Next 24-hour Sikkim flood risk remains below alert thresholds.",
            "districts": [],
        })
    return {
        "city": "sikkim",
        "alert_count": len(active_alerts),
        "flood_probability": city_pred["flood_probability"],
        "risk_level": city_pred["risk_level"],
        "alerts": active_alerts,
        "timestamp": live["timestamp"],
        "horizon_hours": PREDICTION_HORIZON_HOURS,
    }


def simulate_payload(rainfall_mm: float, duration_hr: float, water_level: float, soil_pct: float, drain_condition: float) -> dict:
    forecast_start, forecast_end = _window_meta()
    adjusted_rain = rainfall_mm * max(1.0, duration_hr / 3.0) * (1.0 + (1.0 - drain_condition) * 0.35)
    adjusted_water = water_level * (1.0 + (duration_hr / 24.0) * 0.16 + (1.0 - drain_condition) * 0.22)
    adjusted_soil = min(100.0, soil_pct + duration_hr * 2.2 + (1.0 - drain_condition) * 12.0)

    live = {
        **get_live_inputs(),
        "timestamp": datetime.now().isoformat(),
        "forecast_start": forecast_start,
        "forecast_end": forecast_end,
        "rainfall_mm": round(adjusted_rain, 2),
        "today_total_mm": round(adjusted_rain * max(1.0, duration_hr / 2.0), 2),
        "tomorrow_total_mm": round(adjusted_rain * 0.6, 2),
        "soil_pct": round(adjusted_soil, 2),
        "water_level_m": round(adjusted_water, 2),
        "current_level_m": round(water_level, 2),
        "water_level_change": round(adjusted_water - water_level, 2),
        "discharge_m3s": round(max(0.0, (adjusted_water - 4.0) * 180.0), 2),
        "current_discharge_m3s": round(max(0.0, (water_level - 4.0) * 180.0), 2),
        "water_status": "DANGER" if adjusted_water >= 12.0 else "WARNING" if adjusted_water >= 9.0 else "NORMAL",
    }
    df = run_pipeline_for_live(live=live, force_refresh=True)
    prediction = predict_summary(live, df)
    hotspots, _ = hotspots_payload(live=live, risk="all", limit=len(df))
    affected = [row for row in hotspots if row["probability"] >= 0.45]
    return {
        "scenario": {
            "rainfall_mm": rainfall_mm,
            "duration_hr": duration_hr,
            "yamuna_level": water_level,
            "soil_saturation": soil_pct,
            "drain_condition": drain_condition,
        },
        "prediction": prediction,
        "impact_estimate": {
            "affected_cells": len(affected),
            "high_risk_cells": len([row for row in hotspots if row["risk_level"] in ["CRITICAL", "HIGH"]]),
            "top_hotspots": hotspots[:10],
        },
        "timestamp": datetime.now().isoformat(),
    }
