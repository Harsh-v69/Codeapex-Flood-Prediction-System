"""
DFIS — Delhi Flood Intelligence System
python/ward_readiness.py
Ward-Level Pre-Monsoon Readiness Score Calculator (272 Delhi Wards)
"""

import pandas as pd
import numpy as np
from dataclasses import dataclass, asdict
from typing import List, Dict

# ── Score weights (MCD / DDMA framework) ─────────────────────────────────────
READINESS_WEIGHTS = {
    "drainage_capacity":          0.30,   # DJTB drain desilting % complete
    "pump_availability":          0.25,   # Delhi Flood Control Order pumps per ward
    "road_drainage_condition":    0.20,   # PWD stormwater drain survey score
    "emergency_response":         0.15,   # DDMA relief teams + equipment
    "citizen_preparedness":       0.10,   # Awareness + early warning coverage
}
assert abs(sum(READINESS_WEIGHTS.values()) - 1.0) < 1e-9

# ── Readiness score classification ───────────────────────────────────────────
READINESS_LEVELS = {
    "NOT_READY":  (0,  40),    # Immediate intervention required
    "MODERATE":   (40, 70),    # Resource boost needed
    "PREPARED":   (70, 100),   # Adequate readiness
}


@dataclass
class WardData:
    """Input data for a single Delhi ward."""
    ward_id:       str
    ward_name:     str
    district:      str
    flood_risk:    str   # critical | high | medium | low

    # Score components (0–100 each)
    drainage_capacity:        float   # % drains desilted / cleaned
    pump_availability:        float   # % pumps operational vs required
    road_drainage_condition:  float   # PWD road drainage audit score
    emergency_response:       float   # DDMA team + resource readiness
    citizen_preparedness:     float   # Early warning coverage + awareness


@dataclass
class WardReadinessResult:
    """Output for a single ward."""
    ward_id:          str
    ward_name:        str
    district:         str
    flood_risk:       str
    readiness_score:  float
    readiness_level:  str
    component_scores: Dict[str, float]
    priority_action:  str
    resources_needed: List[str]


def compute_readiness_score(ward: WardData, weights: dict = READINESS_WEIGHTS) -> float:
    """
    Compute composite Pre-Monsoon Readiness Score (0–100) for a ward.

    Readiness Score =
        0.30 × DrainageCapacity
      + 0.25 × PumpAvailability
      + 0.20 × RoadDrainageCondition
      + 0.15 × EmergencyResponse
      + 0.10 × CitizenPreparedness
    """
    score = (
        weights["drainage_capacity"]       * ward.drainage_capacity       +
        weights["pump_availability"]       * ward.pump_availability       +
        weights["road_drainage_condition"] * ward.road_drainage_condition +
        weights["emergency_response"]      * ward.emergency_response      +
        weights["citizen_preparedness"]    * ward.citizen_preparedness
    )
    return round(float(np.clip(score, 0, 100)), 1)


def classify_readiness(score: float) -> str:
    """Return readiness level string for a given score."""
    if score < 40:
        return "NOT_READY"
    elif score < 70:
        return "MODERATE"
    return "PREPARED"


def generate_priority_action(ward: WardData, score: float) -> str:
    """Generate human-readable priority action for a ward."""
    if ward.drainage_capacity < 30:
        return "🚨 Emergency drain desilting + pump deployment NOW"
    if ward.pump_availability < 30:
        return "🚒 Deploy additional pumps immediately"
    if ward.flood_risk == "critical" and score < 40:
        return "🔴 CRITICAL: Full emergency response activation"
    if ward.flood_risk in ("critical", "high") and score < 60:
        return "⚠️ Pre-position pumps, rescue teams, sandbags"
    if score < 40:
        return "⚠️ Multi-resource intervention required"
    if score < 70:
        return "📋 Monitor + pre-position resources"
    return "✅ Maintain readiness — routine checks"


def generate_resources_needed(ward: WardData) -> List[str]:
    """Return list of specific resource gaps for a ward."""
    needed = []
    if ward.drainage_capacity < 50:
        needed.append("Drain desilting crew")
    if ward.pump_availability < 50:
        pumps = max(1, int((50 - ward.pump_availability) / 10))
        needed.append(f"{pumps} motor pump(s)")
    if ward.road_drainage_condition < 40:
        needed.append("PWD road drain inspection")
    if ward.emergency_response < 50:
        needed.append("DDMA rescue team assignment")
    if ward.citizen_preparedness < 40:
        needed.append("SMS/loudspeaker awareness drive")
    if not needed:
        needed.append("No critical gaps — maintain readiness")
    return needed


def score_ward(ward: WardData) -> WardReadinessResult:
    """Full scoring pipeline for one ward."""
    score = compute_readiness_score(ward)
    level = classify_readiness(score)
    return WardReadinessResult(
        ward_id          = ward.ward_id,
        ward_name        = ward.ward_name,
        district         = ward.district,
        flood_risk       = ward.flood_risk,
        readiness_score  = score,
        readiness_level  = level,
        component_scores = {
            "drainage_capacity":       ward.drainage_capacity,
            "pump_availability":       ward.pump_availability,
            "road_drainage_condition": ward.road_drainage_condition,
            "emergency_response":      ward.emergency_response,
            "citizen_preparedness":    ward.citizen_preparedness,
        },
        priority_action  = generate_priority_action(ward, score),
        resources_needed = generate_resources_needed(ward),
    )


def score_all_wards(wards: List[WardData]) -> pd.DataFrame:
    """
    Score all wards and return results as a sorted DataFrame.
    Sorted by readiness_score ascending (worst wards first).
    """
    results = [asdict(score_ward(w)) for w in wards]
    df      = pd.DataFrame(results)
    df      = df.sort_values("readiness_score", ascending=True).reset_index(drop=True)
    return df


def generate_city_summary(df: pd.DataFrame) -> Dict:
    """Generate city-level readiness summary statistics."""
    return {
        "city":              "Delhi NCT",
        "total_wards":       len(df),
        "avg_score":         round(df["readiness_score"].mean(), 1),
        "not_ready":         int((df["readiness_level"] == "NOT_READY").sum()),
        "moderate":          int((df["readiness_level"] == "MODERATE").sum()),
        "prepared":          int((df["readiness_level"] == "PREPARED").sum()),
        "critical_risk":     int((df["flood_risk"] == "critical").sum()),
        "high_risk":         int((df["flood_risk"] == "high").sum()),
        "worst_wards":       df.head(5)["ward_name"].tolist(),
        "best_wards":        df.tail(5)["ward_name"].tolist(),
    }


# ── Sample Data (represents subset of Delhi's 272 wards) ─────────────────────
SAMPLE_WARDS = [
    WardData("W036N", "Ward 36N – Shahdara",       "North East", "critical", 18, 20, 22, 30, 25),
    WardData("W057E", "Ward 57E – Mustafabad",      "North East", "critical", 22, 18, 18, 28, 20),
    WardData("W051N", "Ward 51N – Burari",          "North",      "critical", 25, 22, 20, 32, 28),
    WardData("W008N", "Ward 08N – Narela",          "North",      "high",     30, 28, 25, 40, 35),
    WardData("W012E", "Ward 12E – Geeta Colony",    "North East", "high",     35, 35, 30, 45, 38),
    WardData("W044NW","Ward 44NW – Rohini S11",     "North West", "high",     40, 42, 35, 50, 42),
    WardData("W022C", "Ward 22C – Karol Bagh",      "Central",    "medium",   60, 65, 58, 72, 68),
    WardData("W033W", "Ward 33W – Janakpuri",       "West",       "medium",   55, 60, 52, 68, 62),
    WardData("W018E", "Ward 18E – Trilokpuri",      "East",       "medium",   50, 55, 48, 62, 58),
    WardData("W005S", "Ward 05S – Saket",           "South",      "low",      80, 85, 78, 88, 82),
    WardData("W002S", "Ward 02S – Vasant Kunj",     "South West", "low",      85, 88, 82, 90, 85),
    WardData("W015NW","Ward 15NW – Dwarka S21",     "South West", "low",      78, 82, 75, 85, 80),
]


if __name__ == "__main__":
    df      = score_all_wards(SAMPLE_WARDS)
    summary = generate_city_summary(df)

    print("\n════ DELHI PRE-MONSOON READINESS REPORT ════")
    print(f"  City Average Score : {summary['avg_score']}/100")
    print(f"  Not Ready (<40)    : {summary['not_ready']} wards")
    print(f"  Moderate  (40–70)  : {summary['moderate']} wards")
    print(f"  Prepared  (>70)    : {summary['prepared']} wards")
    print(f"\n  ⚠️  Worst 5 wards   : {summary['worst_wards']}")
    print(f"  ✅  Best  5 wards   : {summary['best_wards']}")
    print("\n════ WARD TABLE ════")
    cols = ["ward_name","district","flood_risk","readiness_score","readiness_level","priority_action"]
    print(df[cols].to_string(index=False))

    df.to_csv("output/delhi_ward_readiness.csv", index=False)
    print("\n✅ Saved → output/delhi_ward_readiness.csv")
