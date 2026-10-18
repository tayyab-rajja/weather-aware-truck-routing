"""
Open-Meteo hourly weather fetch with in-memory cache.

Returns wind (mph), rain (in/hr), snow (in/hr) for a lat/lng at a target time.
Also supports bulk hourly series for the 48h heatmap corridor.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import requests

# Cache keyed by (rounded lat, rounded lng) → full hourly payload
_CACHE: dict[tuple[float, float], dict[str, Any]] = {}

MS_TO_MPH = 2.23693629
MM_TO_IN = 1 / 25.4


class WeatherError(Exception):
    pass


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float
    temperature_f: float | None
    observed_at: str  # ISO hour used


def _round_key(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, 2), round(lng, 2))


def _fetch_forecast(lat: float, lng: float) -> dict[str, Any]:
    key = _round_key(lat, lng)
    if key in _CACHE:
        return _CACHE[key]

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": key[0],
        "longitude": key[1],
        "hourly": "wind_speed_10m,precipitation,snowfall,temperature_2m",
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
        "temperature_unit": "fahrenheit",
        "forecast_days": 3,
        "timezone": "UTC",
    }
    resp = requests.get(url, params=params, timeout=25)
    if resp.status_code != 200:
        raise WeatherError(f"Open-Meteo failed ({resp.status_code})")
    data = resp.json()
    hourly = data.get("hourly") or {}
    if not hourly.get("time"):
        raise WeatherError("Open-Meteo returned no hourly data")
    _CACHE[key] = hourly
    return hourly


def clear_cache() -> None:
    _CACHE.clear()


def _nearest_index(times: list[str], target: datetime) -> int:
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    else:
        target = target.astimezone(timezone.utc)
    target_ts = target.timestamp()
    best_i = 0
    best_delta = float("inf")
    for i, t in enumerate(times):
        dt = datetime.fromisoformat(t).replace(tzinfo=timezone.utc)
        delta = abs(dt.timestamp() - target_ts)
        if delta < best_delta:
            best_delta = delta
            best_i = i
    return best_i


def _sample_from_hourly(hourly: dict[str, Any], i: int) -> WeatherSample:
    times: list[str] = hourly["time"]
    wind_ms = float(hourly["wind_speed_10m"][i] or 0)
    precip_mm = float(hourly["precipitation"][i] or 0)
    snow_cm = float(hourly.get("snowfall", [0] * len(times))[i] or 0)
    temp = hourly.get("temperature_2m", [None] * len(times))[i]
    return WeatherSample(
        wind_mph=wind_ms * MS_TO_MPH,
        rain_in_hr=precip_mm * MM_TO_IN,
        snow_in_hr=snow_cm / 2.54,  # Open-Meteo snowfall is cm → inches
        temperature_f=float(temp) if temp is not None else None,
        observed_at=times[i],
    )


def sample_at(lat: float, lng: float, when: datetime) -> WeatherSample:
    hourly = _fetch_forecast(lat, lng)
    i = _nearest_index(hourly["time"], when)
    return _sample_from_hourly(hourly, i)


def hourly_risk_series(
    lat: float,
    lng: float,
    *,
    start: datetime,
    hours: int,
    load_weight_lb: float,
    assess_fn: Callable[..., Any],
) -> list[dict[str, Any]]:
    """Precompute risk for `hours` consecutive forecast hours for the heatmap slider."""
    hourly = _fetch_forecast(lat, lng)
    times: list[str] = hourly["time"]
    start_i = _nearest_index(times, start)
    out: list[dict[str, Any]] = []
    for offset in range(hours):
        i = min(start_i + offset, len(times) - 1)
        sample = _sample_from_hourly(hourly, i)
        risk = assess_fn(
            wind_mph=sample.wind_mph,
            rain_in_hr=sample.rain_in_hr,
            snow_in_hr=sample.snow_in_hr,
            load_weight_lb=load_weight_lb,
        )
        out.append(
            {
                "hour_offset": offset,
                "time": times[i],
                "wind_mph": round(sample.wind_mph, 1),
                "rain_in_hr": round(sample.rain_in_hr, 3),
                "snow_in_hr": round(sample.snow_in_hr, 3),
                "risk": risk.risk,
                "score": risk.score,
            }
        )
    return out
