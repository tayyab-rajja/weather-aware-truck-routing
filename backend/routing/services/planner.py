"""
Orchestrates: geocode → directions → sample → weather → risk → metrics → recommend → heatmap.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from routing.services import mapbox, weather
from routing.services.mapbox import MapboxError, Place
from routing.services.metrics import ScoredCheckpoint, compute_metrics
from routing.services.recommend import pick_recommended, why_recommended
from routing.services.risk import assess_risk
from routing.services.sampling import sample_checkpoints
from routing.services.weather import WeatherError


@dataclass
class AnalyzeInput:
    origin: str
    destination: str
    departure_at: datetime
    load_weight_lb: float
    sample_interval_miles: int
    origin_coords: tuple[float, float] | None = None
    destination_coords: tuple[float, float] | None = None


HEATMAP_HOURS = 48
# Subsample corridor points for heatmap (keep UI smooth)
HEATMAP_POINT_INTERVAL_MILES = 50


def analyze(data: AnalyzeInput) -> dict[str, Any]:
    origin = _resolve(data.origin, data.origin_coords)
    destination = _resolve(data.destination, data.destination_coords)
    raw_routes = mapbox.directions(origin, destination)

    built: list[dict[str, Any]] = []
    metrics_pairs: list[tuple[str, Any]] = []

    for raw in raw_routes:
        cps = sample_checkpoints(
            raw.geometry,
            total_miles=raw.distance_miles,
            duration_minutes=raw.duration_minutes,
            departure_at=data.departure_at,
            interval_miles=float(data.sample_interval_miles),
        )

        scored_for_metrics: list[ScoredCheckpoint] = []
        checkpoint_payloads: list[dict[str, Any]] = []

        for cp in cps:
            wx = weather.sample_at(cp.lat, cp.lng, cp.eta)
            risk = assess_risk(
                wind_mph=wx.wind_mph,
                rain_in_hr=wx.rain_in_hr,
                snow_in_hr=wx.snow_in_hr,
                load_weight_lb=data.load_weight_lb,
            )
            scored_for_metrics.append(
                ScoredCheckpoint(mile=cp.mile, risk=risk.risk, score=risk.score)
            )
            checkpoint_payloads.append(
                {
                    "mile": cp.mile,
                    "eta": cp.eta.isoformat(),
                    "lng": round(cp.lng, 6),
                    "lat": round(cp.lat, 6),
                    "weather": {
                        "wind_mph": round(wx.wind_mph, 1),
                        "rain_in_hr": round(wx.rain_in_hr, 3),
                        "snow_in_hr": round(wx.snow_in_hr, 3),
                        "temperature_f": round(wx.temperature_f, 1) if wx.temperature_f is not None else None,
                        "observed_at": wx.observed_at,
                    },
                    "risk": risk.risk,
                    "score": risk.score,
                    "risk_reasons": risk.reasons,
                }
            )

        metrics = compute_metrics(
            scored_for_metrics,
            duration_minutes=raw.duration_minutes,
            total_miles=raw.distance_miles,
        )
        metrics_pairs.append((raw.id, metrics))
        built.append(
            {
                "id": raw.id,
                "summary": raw.summary,
                "distance_miles": round(raw.distance_miles, 1),
                "duration_minutes": round(raw.duration_minutes, 1),
                "geometry": raw.geometry,
                "checkpoints": checkpoint_payloads,
                "metrics": {
                    "severe_miles": metrics.severe_miles,
                    "high_miles": metrics.high_miles,
                    "no_travel_miles": metrics.no_travel_miles,
                    "avg_risk": metrics.avg_risk,
                    "travel_time_minutes": metrics.travel_time_minutes,
                    "total_miles": metrics.total_miles,
                },
                "is_recommended": False,
                "recommendation_reason": "",
            }
        )

    recommended_id = pick_recommended(metrics_pairs)
    metrics_by_id = {rid: m for rid, m in metrics_pairs}
    for route in built:
        if route["id"] == recommended_id:
            route["is_recommended"] = True
            others = [m for rid, m in metrics_pairs if rid != recommended_id]
            route["recommendation_reason"] = why_recommended(metrics_by_id[route["id"]], others)

    heatmap = _build_heatmap(
        geometry=raw_routes[0].geometry if raw_routes else [],
        total_miles=raw_routes[0].distance_miles if raw_routes else 0,
        departure_at=data.departure_at,
        load_weight_lb=data.load_weight_lb,
    )

    return {
        "origin": {"label": origin.label, "lng": origin.lng, "lat": origin.lat},
        "destination": {"label": destination.label, "lng": destination.lng, "lat": destination.lat},
        "departure_at": data.departure_at.isoformat(),
        "load_weight_lb": data.load_weight_lb,
        "sample_interval_miles": data.sample_interval_miles,
        "routes": built,
        "recommended_route_id": recommended_id,
        "heatmap": heatmap,
    }


def _resolve(label: str, coords: tuple[float, float] | None) -> Place:
    if coords and len(coords) == 2:
        return Place(label=label, lng=float(coords[0]), lat=float(coords[1]))
    return mapbox.geocode(label)


def _build_heatmap(
    *,
    geometry: list[list[float]],
    total_miles: float,
    departure_at: datetime,
    load_weight_lb: float,
) -> dict[str, Any]:
    """
    Corridor points with a 48-hour risk series each.
    Slider hour_offset 0..47 selects which score to color on the map.
    """
    if not geometry or total_miles <= 0:
        return {"hours": HEATMAP_HOURS, "points": []}

    # Reuse sampling at a coarser interval for heatmap density.
    interval = min(HEATMAP_POINT_INTERVAL_MILES, max(10, total_miles / 8))
    cps = sample_checkpoints(
        geometry,
        total_miles=total_miles,
        duration_minutes=0,  # ETA not needed for forecast-hour series
        departure_at=departure_at,
        interval_miles=interval,
    )

    points: list[dict[str, Any]] = []
    for cp in cps:
        series = weather.hourly_risk_series(
            cp.lat,
            cp.lng,
            start=departure_at,
            hours=HEATMAP_HOURS,
            load_weight_lb=load_weight_lb,
            assess_fn=assess_risk,
        )
        points.append(
            {
                "lng": round(cp.lng, 6),
                "lat": round(cp.lat, 6),
                "mile": cp.mile,
                "hours": [
                    {"hour_offset": h["hour_offset"], "score": h["score"], "risk": h["risk"], "time": h["time"]}
                    for h in series
                ],
            }
        )

    return {"hours": HEATMAP_HOURS, "start": departure_at.isoformat(), "points": points}


# Re-export errors for views
__all__ = ["AnalyzeInput", "analyze", "MapboxError", "WeatherError"]
