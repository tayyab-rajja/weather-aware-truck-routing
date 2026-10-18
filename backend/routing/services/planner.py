"""
Orchestrates: geocode → directions → sample → weather → risk → metrics → recommend → heatmap.
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
HEATMAP_POINT_INTERVAL_MILES = 50


def analyze(data: AnalyzeInput) -> dict[str, Any]:
    origin = _resolve(data.origin, data.origin_coords)
    destination = _resolve(data.destination, data.destination_coords)
    raw_routes = geo.directions(origin, destination)

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

    # Heatmap along the recommended corridor (fallback: first route)
    heat_idx = next((i for i, r in enumerate(built) if r["is_recommended"]), 0)
    heat_src = raw_routes[heat_idx] if raw_routes else None

    heatmap = _build_heatmap(
        geometry=heat_src.geometry if heat_src else [],
        total_miles=heat_src.distance_miles if heat_src else 0,
        departure_at=data.departure_at,
        load_weight_lb=data.load_weight_lb,
        # Also sprinkle points from other routes so the corridor heatmap covers alternatives
        extra_geometries=[(r.geometry, r.distance_miles) for i, r in enumerate(raw_routes) if i != heat_idx],
    )

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


def _build_heatmap(
    *,
    geometry: list[list[float]],
    total_miles: float,
    departure_at: datetime,
    load_weight_lb: float,
    extra_geometries: list[tuple[list[list[float]], float]] | None = None,
) -> dict[str, Any]:
    """Corridor points with a 48-hour risk series each (slider hour_offset 0..47)."""
    if not geometry or total_miles <= 0:
        return {"hours": HEATMAP_HOURS, "points": []}

    samples: list[tuple[float, float, float]] = []  # lng, lat, mile

    def _collect(geom: list[list[float]], miles: float, interval: float) -> None:
        cps = sample_checkpoints(
            geom,
            total_miles=miles,
            duration_minutes=0,
            departure_at=departure_at,
            interval_miles=interval,
        )
        for cp in cps:
            samples.append((cp.lng, cp.lat, cp.mile))

    interval = min(HEATMAP_POINT_INTERVAL_MILES, max(10, total_miles / 8))
    _collect(geometry, total_miles, interval)
    for geom, miles in extra_geometries or []:
        if miles > 0 and geom:
            _collect(geom, miles, max(interval, 60))

    # Deduplicate nearby samples (~0.15°)
    unique: list[tuple[float, float, float]] = []
    for lng, lat, mile in samples:
        if any(abs(lng - u[0]) < 0.15 and abs(lat - u[1]) < 0.15 for u in unique):
            continue
        unique.append((lng, lat, mile))

    points: list[dict[str, Any]] = []
    for lng, lat, mile in unique:
        series = weather.hourly_risk_series(
            lat,
            lng,
            start=departure_at,
            hours=HEATMAP_HOURS,
            load_weight_lb=load_weight_lb,
            assess_fn=assess_risk,
        )
        points.append(
            {
                "lng": round(lng, 6),
                "lat": round(lat, 6),
                "mile": mile,
                "hours": [
                    {
                        "hour_offset": h["hour_offset"],
                        "score": h["score"],
                        "risk": h["risk"],
                        "time": h["time"],
                    }
                    for h in series
                ],
            }
        )

    return {"hours": HEATMAP_HOURS, "start": departure_at.isoformat(), "points": points}


__all__ = ["AnalyzeInput", "analyze", "RoutingError", "WeatherError"]
