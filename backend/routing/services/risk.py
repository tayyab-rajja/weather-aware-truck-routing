"""
Weather and load risk classification.

Levels (worst of wind / rain / snow, then load overrides):
  low | moderate | high | severe | no_travel
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RiskLevel = Literal["low", "moderate", "high", "severe", "no_travel"]

RISK_SCORE: dict[RiskLevel, int] = {
    "low": 1,
    "moderate": 2,
    "high": 3,
    "severe": 4,
    "no_travel": 5,
}


def classify_wind(mph: float) -> RiskLevel:
    if mph < 25:
        return "low"
    if mph < 35:
        return "moderate"
    if mph < 45:
        return "high"
    if mph < 55:
        return "severe"
    return "no_travel"


def classify_rain(inches_per_hour: float) -> RiskLevel:
    if inches_per_hour < 0.10:
        return "low"
    if inches_per_hour < 0.25:
        return "moderate"
    if inches_per_hour < 0.50:
        return "high"
    if inches_per_hour <= 1.00:
        return "severe"
    return "no_travel"


def classify_snow(inches_per_hour: float) -> RiskLevel:
    if inches_per_hour < 0.5:
        return "low"
    if inches_per_hour < 1.0:
        return "moderate"
    if inches_per_hour < 2.0:
        return "high"
    if inches_per_hour <= 3.0:
        return "severe"
    return "no_travel"


def _worse(a: RiskLevel, b: RiskLevel) -> RiskLevel:
    return a if RISK_SCORE[a] >= RISK_SCORE[b] else b


def apply_load_overrides(
    wind_mph: float, load_weight_lb: float, current: RiskLevel
) -> tuple[RiskLevel, list[str]]:
    """
    Load rules:
      - wind >= 55 mph → No Travel (any load)
      - wind 45–54 mph and weight > 30,000 lb → No Travel
      - wind 35–44 mph and weight > 40,000 lb → Severe
    """
    if wind_mph >= 55:
        return "no_travel", ["wind ≥55 mph → no travel (any load)"]

    if 45 <= wind_mph < 55 and load_weight_lb > 30_000:
        return "no_travel", ["wind 45–54 mph + load >30,000 lb → no travel"]

    if 35 <= wind_mph < 45 and load_weight_lb > 40_000:
        # Escalate only; never downgrade a worse weather level.
        if RISK_SCORE[current] < RISK_SCORE["severe"]:
            return "severe", ["wind 35–44 mph + load >40,000 lb → severe"]
        return current, ["wind 35–44 mph + load >40,000 lb → severe"]

    return current, []


@dataclass(frozen=True)
class RiskResult:
    risk: RiskLevel
    score: int
    wind_risk: RiskLevel
    rain_risk: RiskLevel
    snow_risk: RiskLevel
    reasons: list[str]


def _weather_reasons(
    *,
    wind_mph: float,
    rain_in_hr: float,
    snow_in_hr: float,
    wind_r: RiskLevel,
    rain_r: RiskLevel,
    snow_r: RiskLevel,
    weather: RiskLevel,
) -> list[str]:
    """List every factor that ties for the worst weather level."""
    if weather == "low":
        return []
    reasons: list[str] = []
    if wind_r == weather:
        reasons.append(f"wind {wind_mph:.1f} mph → {wind_r}")
    if rain_r == weather:
        reasons.append(f"rain {rain_in_hr:.3f} in/hr → {rain_r}")
    if snow_r == weather:
        reasons.append(f"snow {snow_in_hr:.2f} in/hr → {snow_r}")
    return reasons


def assess_risk(
    *,
    wind_mph: float,
    rain_in_hr: float,
    snow_in_hr: float,
    load_weight_lb: float,
) -> RiskResult:
    wind_r = classify_wind(wind_mph)
    rain_r = classify_rain(rain_in_hr)
    snow_r = classify_snow(snow_in_hr)

    weather = _worse(_worse(wind_r, rain_r), snow_r)
    reasons = _weather_reasons(
        wind_mph=wind_mph,
        rain_in_hr=rain_in_hr,
        snow_in_hr=snow_in_hr,
        wind_r=wind_r,
        rain_r=rain_r,
        snow_r=snow_r,
        weather=weather,
    )

    final, load_reasons = apply_load_overrides(wind_mph, load_weight_lb, weather)
    reasons.extend(load_reasons)

    return RiskResult(
        risk=final,
        score=RISK_SCORE[final],
        wind_risk=wind_r,
        rain_risk=rain_r,
        snow_risk=snow_r,
        reasons=reasons or ["conditions within low thresholds"],
    )
