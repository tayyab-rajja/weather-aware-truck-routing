"""
Open-Meteo weather with caching + resilient fetches (retries on 503/429).
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence

import requests

_CACHE: dict[tuple[float, float], dict[str, Any]] = {}
_SESSION = requests.Session()

MS_TO_MPH = 2.23693629
MM_TO_IN = 1 / 25.4
# ~28 miles at mid-latitudes — fewer cells, still corridor-accurate
_GRID = 0.4
_HOURLY_VARS = "wind_speed_10m,rain,snowfall,temperature_2m"
_RETRYABLE = {429, 500, 502, 503, 504}


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


def _get_with_retry(url: str, params: dict[str, Any], *, timeout: float, attempts: int = 4) -> requests.Response:
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = _SESSION.get(url, params=params, timeout=timeout)
            if resp.status_code in _RETRYABLE and attempt < attempts - 1:
                time.sleep(0.6 * (2**attempt))
                continue
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < attempts - 1:
                time.sleep(0.6 * (2**attempt))
                continue
            raise WeatherError(f"Open-Meteo request failed: {exc}") from exc
    if last_exc:
        raise WeatherError(f"Open-Meteo request failed: {last_exc}") from last_exc
    raise WeatherError("Open-Meteo request failed")


def _forecast_params(**extra: Any) -> dict[str, Any]:
    params = {
        "hourly": _HOURLY_VARS,
        "wind_speed_unit": "ms",
        "precipitation_unit": "mm",
        "temperature_unit": "fahrenheit",
        "forecast_days": 3,
        "timezone": "UTC",
    }
    params.update(extra)
    return params


def _fetch_one(key: tuple[float, float]) -> tuple[tuple[float, float], dict[str, Any]]:
    url = "https://api.open-meteo.com/v1/forecast"
    resp = _get_with_retry(
        url,
        _forecast_params(latitude=key[0], longitude=key[1]),
        timeout=12,
    )
    if resp.status_code != 200:
        raise WeatherError(f"Open-Meteo failed ({resp.status_code})")
    data = resp.json()
    hourly = data.get("hourly") or {}
    if not hourly.get("time"):
        raise WeatherError("Open-Meteo returned no hourly data")
    return key, hourly


def _fetch_batch(keys: Sequence[tuple[float, float]]) -> None:
    """Fetch several locations in one request; fall back gently on failure."""
    if not keys:
        return
    if len(keys) == 1:
        k, hourly = _fetch_one(keys[0])
        _CACHE[k] = hourly
        return

    url = "https://api.open-meteo.com/v1/forecast"
    params = _forecast_params(
        latitude=",".join(str(k[0]) for k in keys),
        longitude=",".join(str(k[1]) for k in keys),
    )
    try:
        resp = _get_with_retry(url, params, timeout=18, attempts=3)
    except WeatherError:
        _fetch_parallel(keys)
        return

    if resp.status_code != 200:
        _fetch_parallel(keys)
        return

    payload = resp.json()
    items = payload if isinstance(payload, list) else [payload]
    if len(items) != len(keys):
        _fetch_parallel(keys)
        return

    for key, data in zip(keys, items):
        hourly = data.get("hourly") or {}
        if hourly.get("time"):
            _CACHE[key] = hourly
        else:
            # Fill missing cell individually
            try:
                k, hourly = _fetch_one(key)
                _CACHE[k] = hourly
            except WeatherError:
                continue


def _fetch_parallel(keys: Sequence[tuple[float, float]]) -> None:
    # Keep concurrency modest to avoid Open-Meteo 503 rate limits
    workers = min(4, max(1, len(keys)))
    errors: list[Exception] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_one, k): k for k in keys}
        for fut in as_completed(futures):
            try:
                key, hourly = fut.result()
                _CACHE[key] = hourly
            except Exception as exc:  # noqa: BLE001 — collect then decide
                errors.append(exc)
    if errors and len(errors) == len(keys):
        raise WeatherError(str(errors[0]))


def prefetch(locations: Iterable[tuple[float, float]]) -> None:
    """Warm cache for all unique grid cells (batch, sequential chunks)."""
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

    # Smaller sequential batches reduce 503s vs hammering in parallel
    chunk = 20
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
    rain_mm = hourly.get("rain") or hourly.get("precipitation") or [0] * len(times)
    rain_in = float(rain_mm[i] or 0) * MM_TO_IN
    snow_cm = float(hourly.get("snowfall", [0] * len(times))[i] or 0)
    temp = hourly.get("temperature_2m", [None] * len(times))[i]
    return WeatherSample(
        wind_mph=wind_ms * MS_TO_MPH,
        rain_in_hr=rain_in,
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
