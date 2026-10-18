"""
Free geocoding + directions (no paid APIs).

- Geocode / autocomplete: Nominatim (OpenStreetMap)
- Routes: OSRM public demo server

Always aims for 3 distinct driving options:
1) OSRM alternatives query
2) If fewer than 3, real OSRM routes via offset midpoints (still API routes, not invented paths)
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import requests

OSRM_BASE = "https://router.project-osrm.org"
NOMINATIM = "https://nominatim.openstreetmap.org"
USER_AGENT = "WeatherAwareTruckRouting/1.0 (open-source assessment; free APIs only)"
TARGET_ROUTES = 3


class RoutingError(Exception):
    """Raised when geocoding or routing fails."""


@dataclass(frozen=True)
class Place:
    label: str
    lng: float
    lat: float


@dataclass(frozen=True)
class RawRoute:
    id: str
    distance_miles: float
    duration_minutes: float
    geometry: list[list[float]]  # [lng, lat]
    summary: str


def geocode(query: str) -> Place:
    resp = requests.get(
        f"{NOMINATIM}/search",
        params={"q": query, "format": "json", "limit": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    if resp.status_code != 200:
        raise RoutingError(f"Geocoding failed ({resp.status_code})")
    results = resp.json() or []
    if not results:
        raise RoutingError(f"Could not geocode: {query!r}")
    hit = results[0]
    return Place(
        label=hit.get("display_name") or query,
        lng=float(hit["lon"]),
        lat=float(hit["lat"]),
    )


def suggest_places(query: str, limit: int = 5) -> list[dict[str, Any]]:
    if not query or len(query.strip()) < 2:
        return []
    resp = requests.get(
        f"{NOMINATIM}/search",
        params={"q": query.strip(), "format": "json", "limit": limit},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    if resp.status_code != 200:
        return []
    return [
        {
            "label": h.get("display_name") or "",
            "lng": float(h["lon"]),
            "lat": float(h["lat"]),
        }
        for h in (resp.json() or [])
    ]


def directions(origin: Place, destination: Place) -> list[RawRoute]:
    """Return up to 3 real driving routes from OSRM."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    collected: list[RawRoute] = []

    for raw in _osrm_route([origin, destination], alternatives=True):
        _add_unique(collected, raw)
        if len(collected) >= TARGET_ROUTES:
            break

    # Parallel via-point attempts if we still need more alternatives
    if len(collected) < TARGET_ROUTES:
        vias = _offset_vias(origin, destination)[:4]

        def _via_job(via: Place) -> list[RawRoute]:
            return _osrm_route([origin, via, destination], alternatives=False)

        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(_via_job, v) for v in vias]
            for fut in as_completed(futures):
                for raw in fut.result():
                    _add_unique(collected, raw)
                    if len(collected) >= TARGET_ROUTES:
                        break
                if len(collected) >= TARGET_ROUTES:
                    break

    if not collected:
        raise RoutingError("No routes found between origin and destination")

    labels = ["Primary", "Alternative A", "Alternative B"]
    out: list[RawRoute] = []
    for i, r in enumerate(collected[:TARGET_ROUTES]):
        out.append(
            RawRoute(
                id=f"route_{i + 1}",
                distance_miles=r.distance_miles,
                duration_minutes=r.duration_minutes,
                geometry=r.geometry,
                summary=labels[i] if i < len(labels) else f"Route {i + 1}",
            )
        )
    return out


def _osrm_route(points: list[Place], *, alternatives: bool) -> list[RawRoute]:
    coords = ";".join(f"{p.lng},{p.lat}" for p in points)
    url = f"{OSRM_BASE}/route/v1/driving/{coords}"
    params: dict[str, Any] = {
        # simplified is enough for map display and much faster over the wire
        "overview": "simplified",
        "geometries": "geojson",
        "steps": "false",
    }
    if alternatives:
        params["alternatives"] = "true"

    try:
        resp = requests.get(url, params=params, timeout=30)
    except requests.RequestException:
        return []
    if resp.status_code != 200:
        return []
    data = resp.json()
    if data.get("code") != "Ok":
        # Via-point attempts can fail; let caller try the next via
        return []

    routes_raw = data.get("routes") or []
    out: list[RawRoute] = []
    for i, r in enumerate(routes_raw[:TARGET_ROUTES]):
        geom = r.get("geometry") or {}
        coords_list = geom.get("coordinates") or []
        if len(coords_list) < 2:
            continue
        meters = float(r.get("distance") or 0)
        seconds = float(r.get("duration") or 0)
        out.append(
            RawRoute(
                id=f"tmp_{i}",
                distance_miles=meters / 1609.344,
                duration_minutes=seconds / 60.0,
                geometry=[[float(c[0]), float(c[1])] for c in coords_list],
                summary="",
            )
        )
    return out


def _add_unique(bucket: list[RawRoute], candidate: RawRoute) -> None:
    """Skip near-duplicates (same length/time within tolerance)."""
    for existing in bucket:
        if (
            abs(existing.distance_miles - candidate.distance_miles) < 3.0
            and abs(existing.duration_minutes - candidate.duration_minutes) < 5.0
        ):
            return
        # Also compare a mid-point sample
        if _midpoints_close(existing.geometry, candidate.geometry, miles=8):
            return
    bucket.append(candidate)


def _midpoints_close(a: list[list[float]], b: list[list[float]], *, miles: float) -> bool:
    if not a or not b:
        return False
    ma, mb = a[len(a) // 2], b[len(b) // 2]
    return _haversine(ma[0], ma[1], mb[0], mb[1]) < miles


def _haversine(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def _offset_vias(origin: Place, destination: Place) -> list[Place]:
    """
    Build midpoints offset perpendicular to the OD line so OSRM returns
    meaningfully different corridors (still real routed paths).
    """
    mid_lng = (origin.lng + destination.lng) / 2
    mid_lat = (origin.lat + destination.lat) / 2
    dx = destination.lng - origin.lng
    dy = destination.lat - origin.lat
    length = math.hypot(dx, dy) or 1.0
    # Perpendicular unit vector in degree space
    px, py = -dy / length, dx / length

    # Offset ~0.35° and ~0.7° (~20–45 mi depending on latitude)
    vias: list[Place] = []
    for sign in (1, -1):
        for mag in (0.35, 0.7):
            vias.append(
                Place(
                    label="via",
                    lng=mid_lng + sign * mag * px,
                    lat=mid_lat + sign * mag * py,
                )
            )
    return vias
