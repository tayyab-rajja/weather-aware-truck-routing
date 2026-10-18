"""
Geocoding + Directions.

Prefers Mapbox when MAPBOX_TOKEN is set. Falls back to Nominatim + OSRM
(public endpoints) so the demo works without a paid key. OSRM/Mapbox both
support alternatives — we never invent extra routes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import requests
from django.conf import settings


class MapboxError(Exception):
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


def _token() -> str:
    token = (getattr(settings, "MAPBOX_TOKEN", "") or "").strip()
    if not token or token.startswith("PLACEHOLDER"):
        return ""
    return token


def _use_mapbox() -> bool:
    return bool(_token())


def geocode(query: str) -> Place:
    if _use_mapbox():
        return _geocode_mapbox(query)
    return _geocode_nominatim(query)


def directions(origin: Place, destination: Place) -> list[RawRoute]:
    """Return up to 3 driving routes. Does not invent extras if API returns fewer."""
    if _use_mapbox():
        return _directions_mapbox(origin, destination)
    return _directions_osrm(origin, destination)


def suggest_places(query: str, limit: int = 5) -> list[dict[str, Any]]:
    if not query or len(query.strip()) < 2:
        return []
    if _use_mapbox():
        return _suggest_mapbox(query, limit)
    return _suggest_nominatim(query, limit)


# --- Mapbox -----------------------------------------------------------------

def _geocode_mapbox(query: str) -> Place:
    token = _token()
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(query)}.json"
    resp = requests.get(
        url,
        params={"access_token": token, "limit": 1, "types": "place,locality,address,region,postcode"},
        timeout=20,
    )
    if resp.status_code != 200:
        raise MapboxError(f"Geocoding failed ({resp.status_code})")
    features = resp.json().get("features") or []
    if not features:
        raise MapboxError(f"Could not geocode: {query!r}")
    feat = features[0]
    lng, lat = feat["center"]
    return Place(label=feat.get("place_name") or query, lng=float(lng), lat=float(lat))


def _directions_mapbox(origin: Place, destination: Place) -> list[RawRoute]:
    token = _token()
    coords = f"{origin.lng},{origin.lat};{destination.lng},{destination.lat}"
    url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords}"
    resp = requests.get(
        url,
        params={
            "access_token": token,
            "alternatives": "true",
            "geometries": "geojson",
            "overview": "full",
            "steps": "false",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise MapboxError(f"Directions failed ({resp.status_code}): {resp.text[:200]}")
    routes_raw = resp.json().get("routes") or []
    if not routes_raw:
        raise MapboxError("No routes found between origin and destination")
    return [_normalize_mapbox_route(r, i) for i, r in enumerate(routes_raw[:3])]


def _normalize_mapbox_route(route: dict[str, Any], index: int) -> RawRoute:
    geom = route.get("geometry") or {}
    coords_list = geom.get("coordinates") or []
    meters = float(route.get("distance") or 0)
    seconds = float(route.get("duration") or 0)
    return RawRoute(
        id=f"route_{index + 1}",
        distance_miles=meters / 1609.344,
        duration_minutes=seconds / 60.0,
        geometry=[[float(c[0]), float(c[1])] for c in coords_list],
        summary=_route_summary(route, index),
    )


def _route_summary(route: dict[str, Any], index: int) -> str:
    legs = route.get("legs") or []
    if legs and legs[0].get("summary"):
        return str(legs[0]["summary"])
    labels = ["Primary", "Alternative A", "Alternative B"]
    return labels[index] if index < len(labels) else f"Route {index + 1}"


def _suggest_mapbox(query: str, limit: int) -> list[dict[str, Any]]:
    token = _token()
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(query.strip())}.json"
    resp = requests.get(
        url,
        params={
            "access_token": token,
            "limit": limit,
            "types": "place,locality,address,region,postcode",
            "autocomplete": "true",
        },
        timeout=15,
    )
    if resp.status_code != 200:
        raise MapboxError(f"Autocomplete failed ({resp.status_code})")
    features = resp.json().get("features") or []
    return [
        {
            "label": f.get("place_name") or "",
            "lng": float(f["center"][0]),
            "lat": float(f["center"][1]),
        }
        for f in features
    ]


# --- Nominatim + OSRM fallback ----------------------------------------------

_USER_AGENT = "WeatherAwareTruckRouting/1.0 (assessment; contact: local-dev)"


def _geocode_nominatim(query: str) -> Place:
    resp = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": query, "format": "json", "limit": 1},
        headers={"User-Agent": _USER_AGENT},
        timeout=20,
    )
    if resp.status_code != 200:
        raise MapboxError(f"Geocoding failed ({resp.status_code})")
    results = resp.json() or []
    if not results:
        raise MapboxError(f"Could not geocode: {query!r}")
    hit = results[0]
    return Place(
        label=hit.get("display_name") or query,
        lng=float(hit["lon"]),
        lat=float(hit["lat"]),
    )


def _suggest_nominatim(query: str, limit: int) -> list[dict[str, Any]]:
    resp = requests.get(
        "https://nominatim.openstreetmap.org/search",
        params={"q": query.strip(), "format": "json", "limit": limit},
        headers={"User-Agent": _USER_AGENT},
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


def _directions_osrm(origin: Place, destination: Place) -> list[RawRoute]:
    coords = f"{origin.lng},{origin.lat};{destination.lng},{destination.lat}"
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}"
    resp = requests.get(
        url,
        params={
            "alternatives": "true",
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise MapboxError(f"Directions failed ({resp.status_code}): {resp.text[:200]}")
    data = resp.json()
    if data.get("code") != "Ok":
        raise MapboxError(f"Directions failed: {data.get('message') or data.get('code')}")
    routes_raw = data.get("routes") or []
    if not routes_raw:
        raise MapboxError("No routes found between origin and destination")

    out: list[RawRoute] = []
    for i, r in enumerate(routes_raw[:3]):
        geom = r.get("geometry") or {}
        coords_list = geom.get("coordinates") or []
        meters = float(r.get("distance") or 0)
        seconds = float(r.get("duration") or 0)
        out.append(
            RawRoute(
                id=f"route_{i + 1}",
                distance_miles=meters / 1609.344,
                duration_minutes=seconds / 60.0,
                geometry=[[float(c[0]), float(c[1])] for c in coords_list],
                summary=_route_summary(r, i),
            )
        )
    return out
