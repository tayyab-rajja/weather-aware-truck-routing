"""
Weather and load risk classification.

Levels (worst wins among wind/rain/snow, then load overrides apply):
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

_LEVEL_RANK = RISK_SCORE  # higher = worse


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
    return a if _LEVEL_RANK[a] >= _LEVEL_RANK[b] else b


def apply_load_overrides(wind_mph: float, load_weight_lb: float, current: RiskLevel) -> tuple[RiskLevel, list[str]]:
    """
    Load rules:
      - wind >= 55 mph → No Travel (any load)
      - wind 45–54 mph and weight > 30,000 lb → No Travel
      - wind 35–44 mph and weight > 40,000 lb → Severe
    """
    reasons: list[str] = []
    level = current

    if wind_mph >= 55:
        level = "no_travel"
        reasons.append("wind ≥55 mph → no travel (any load)")
        return level, reasons

    if 45 <= wind_mph < 55 and load_weight_lb > 30_000:
        level = "no_travel"
        reasons.append("wind 45–54 mph + load >30,000 lb → no travel")
        return level, reasons

    if 35 <= wind_mph < 45 and load_weight_lb > 40_000:
        # Only escalate; never downgrade a worse weather level.
        if _LEVEL_RANK[level] < _LEVEL_RANK["severe"]:
            level = "severe"
        reasons.append("wind 35–44 mph + load >40,000 lb → severe")
        return level, reasons

    return level, reasons


@dataclass(frozen=True)
class RiskResult:
    risk: RiskLevel
    score: int
    wind_risk: RiskLevel
    rain_risk: RiskLevel
    snow_risk: RiskLevel
    reasons: list[str]


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
    reasons: list[str] = []
    if weather == wind_r and wind_r != "low":
        reasons.append(f"wind {wind_mph:.1f} mph → {wind_r}")
    if weather == rain_r and rain_r != "low" and rain_r == weather:
        if f"rain" not in " ".join(reasons):
            reasons.append(f"rain {rain_in_hr:.3f} in/hr → {rain_r}")
    if snow_r != "low" and _LEVEL_RANK[snow_r] >= _LEVEL_RANK[weather]:
        reasons.append(f"snow {snow_in_hr:.2f} in/hr → {snow_r}")
    if not reasons and weather != "low":
        reasons.append(f"weather risk → {weather}")

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
