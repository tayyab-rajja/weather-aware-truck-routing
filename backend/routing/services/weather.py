"""
Open-Meteo weather with aggressive caching + parallel/batch prefetch.

One forecast fetch per ~0.25° cell covers many nearby checkpoints, which is the
main speed win for multi-route analysis.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence

import requests

# Cache keyed by (rounded lat, rounded lng) → full hourly payload
_CACHE: dict[tuple[float, float], dict[str, Any]] = {}

MS_TO_MPH = 2.23693629
MM_TO_IN = 1 / 25.4
# ~17 miles at mid-latitudes — good enough for corridor weather, far fewer HTTP calls
_GRID = 0.25


class WeatherError(Exception):
    pass


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float
    temperature_f: float | None
    observed_at: str


def _round_key(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat / _GRID) * _GRID, round(lng / _GRID) * _GRID)


def clear_cache() -> None:
    _CACHE.clear()


def _fetch_one(key: tuple[float, float]) -> tuple[tuple[float, float], dict[str, Any]]:
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": key[0],
        "longitude": key[1],
        "hourly": "wind_speed_10m,precipitation,snowfall,temperature_2m",
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
        "temperature_unit": "fahrenheit",
        "forecast_days": 7,
        "timezone": "UTC",
    }
    resp = requests.get(url, params=params, timeout=12)
    if resp.status_code != 200:
        raise WeatherError(f"Open-Meteo failed ({resp.status_code})")
    data = resp.json()
    hourly = data.get("hourly") or {}
    if not hourly.get("time"):
        raise WeatherError("Open-Meteo returned no hourly data")
    return key, hourly


def _fetch_batch(keys: Sequence[tuple[float, float]]) -> None:
    """Fetch up to ~40 locations in one Open-Meteo multi-point request."""
    if not keys:
        return
    lats = ",".join(str(k[0]) for k in keys)
    lngs = ",".join(str(k[1]) for k in keys)
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lats,
        "longitude": lngs,
        "hourly": "wind_speed_10m,precipitation,snowfall,temperature_2m",
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
        "temperature_unit": "fahrenheit",
        "forecast_days": 7,
        "timezone": "UTC",
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        # Fall back to parallel singles
        _fetch_parallel(keys)
        return

    payload = resp.json()
    # Multi-point → list; single → dict
    items = payload if isinstance(payload, list) else [payload]
    if len(items) != len(keys):
        _fetch_parallel(keys)
        return

    for key, data in zip(keys, items):
        hourly = data.get("hourly") or {}
        if hourly.get("time"):
            _CACHE[key] = hourly


def _fetch_parallel(keys: Sequence[tuple[float, float]]) -> None:
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(keys)))) as pool:
        futures = [pool.submit(_fetch_one, k) for k in keys]
        for fut in as_completed(futures):
            key, hourly = fut.result()
            _CACHE[key] = hourly


def prefetch(locations: Iterable[tuple[float, float]]) -> None:
    """Warm cache for all unique grid cells (batch + parallel)."""
    missing: list[tuple[float, float]] = []
    seen: set[tuple[float, float]] = set()
    for lat, lng in locations:
        key = _round_key(lat, lng)
        if key in seen or key in _CACHE:
            continue
        seen.add(key)
        missing.append(key)

    if not missing:
        return

    # Open-Meteo multi-point works well in chunks of ~25–40
    chunk = 30
    for i in range(0, len(missing), chunk):
        _fetch_batch(missing[i : i + chunk])


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
        snow_in_hr=snow_cm / 2.54,
        temperature_f=float(temp) if temp is not None else None,
        observed_at=times[i],
    )


def _get_hourly(lat: float, lng: float) -> dict[str, Any]:
    key = _round_key(lat, lng)
    if key not in _CACHE:
        k, hourly = _fetch_one(key)
        _CACHE[k] = hourly
    return _CACHE[key]


def sample_at(lat: float, lng: float, when: datetime) -> WeatherSample:
    hourly = _get_hourly(lat, lng)
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
    hourly = _get_hourly(lat, lng)
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
