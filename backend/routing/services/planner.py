"""
Orchestrates: geocode → directions → sample → weather → risk → metrics → recommend → heatmap.

Speed strategy: sample all points first, prefetch weather for unique grid cells
in one/few Open-Meteo calls, then score everything from cache.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from routing.services import geo, weather
from routing.services.geo import Place, RoutingError
from routing.services.metrics import ScoredCheckpoint, compute_metrics
from routing.services.recommend import pick_recommended, why_recommended
from routing.services.risk import assess_risk
from routing.services.sampling import Checkpoint, sample_checkpoints
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
# Fewer heatmap cells = faster; still enough for the 48h slider
HEATMAP_POINT_INTERVAL_MILES = 80
HEATMAP_MAX_POINTS = 8


def analyze(data: AnalyzeInput) -> dict[str, Any]:
    origin = _resolve(data.origin, data.origin_coords)
    destination = _resolve(data.destination, data.destination_coords)
    raw_routes = geo.directions(origin, destination)

    # 1) Sample checkpoints for every route (no network)
    route_cps: list[list[Checkpoint]] = []
    for raw in raw_routes:
        route_cps.append(
            sample_checkpoints(
                raw.geometry,
                total_miles=raw.distance_miles,
                duration_minutes=raw.duration_minutes,
                departure_at=data.departure_at,
                interval_miles=float(data.sample_interval_miles),
            )
        )

    # 2) Heatmap sample points along primary corridor only (cheaper)
    heat_geom = raw_routes[0].geometry if raw_routes else []
    heat_miles = raw_routes[0].distance_miles if raw_routes else 0.0
    heat_cps = _heatmap_checkpoints(heat_geom, heat_miles, data.departure_at)

    # 3) Prefetch weather for all unique cells in parallel/batch
    locs: list[tuple[float, float]] = []
    for cps in route_cps:
        for cp in cps:
            locs.append((cp.lat, cp.lng))
    for cp in heat_cps:
        locs.append((cp.lat, cp.lng))
    weather.prefetch(locs)

    # 4) Score routes from warm cache
    built: list[dict[str, Any]] = []
    metrics_pairs: list[tuple[str, Any]] = []

    for raw, cps in zip(raw_routes, route_cps):
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
                        "temperature_f": round(wx.temperature_f, 1)
                        if wx.temperature_f is not None
                        else None,
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
            route["recommendation_reason"] = why_recommended(
                metrics_by_id[route["id"]], others
            )

    # Rebuild heatmap on recommended corridor if different from first
    heat_idx = next((i for i, r in enumerate(built) if r["is_recommended"]), 0)
    if heat_idx != 0 and raw_routes:
        heat_cps = _heatmap_checkpoints(
            raw_routes[heat_idx].geometry,
            raw_routes[heat_idx].distance_miles,
            data.departure_at,
        )
        weather.prefetch([(cp.lat, cp.lng) for cp in heat_cps])

    heatmap = {
        "hours": HEATMAP_HOURS,
        "start": data.departure_at.isoformat(),
        "points": [
            {
                "lng": round(cp.lng, 6),
                "lat": round(cp.lat, 6),
                "mile": cp.mile,
                "hours": [
                    {
                        "hour_offset": h["hour_offset"],
                        "score": h["score"],
                        "risk": h["risk"],
                        "time": h["time"],
                    }
                    for h in weather.hourly_risk_series(
                        cp.lat,
                        cp.lng,
                        start=data.departure_at,
                        hours=HEATMAP_HOURS,
                        load_weight_lb=data.load_weight_lb,
                        assess_fn=assess_risk,
                    )
                ],
            }
            for cp in heat_cps
        ],
    }

    return {
        "origin": {"label": origin.label, "lng": origin.lng, "lat": origin.lat},
        "destination": {
            "label": destination.label,
            "lng": destination.lng,
            "lat": destination.lat,
        },
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
    return geo.geocode(label)


def _heatmap_checkpoints(
    geometry: list[list[float]],
    total_miles: float,
    departure_at: datetime,
) -> list[Checkpoint]:
    if not geometry or total_miles <= 0:
        return []
    interval = max(HEATMAP_POINT_INTERVAL_MILES, total_miles / max(1, HEATMAP_MAX_POINTS - 1))
    cps = sample_checkpoints(
        geometry,
        total_miles=total_miles,
        duration_minutes=0,
        departure_at=departure_at,
        interval_miles=interval,
    )
    return cps[:HEATMAP_MAX_POINTS]


__all__ = ["AnalyzeInput", "analyze", "RoutingError", "WeatherError"]
