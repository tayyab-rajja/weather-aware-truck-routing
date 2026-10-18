"""Mapbox Geocoding + Directions (with alternatives)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import requests
from django.conf import settings


class MapboxError(Exception):
    """Raised when Mapbox geocoding or routing fails."""


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
    token = getattr(settings, "MAPBOX_TOKEN", "") or ""
    if not token:
        raise MapboxError("MAPBOX_TOKEN is not configured")
    return token


def geocode(query: str) -> Place:
    token = _token()
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(query)}.json"
    resp = requests.get(
        url,
        params={"access_token": token, "limit": 1, "types": "place,locality,address,region,postcode"},
        timeout=20,
    )
    if resp.status_code != 200:
        raise MapboxError(f"Geocoding failed ({resp.status_code})")
    data = resp.json()
    features = data.get("features") or []
    if not features:
        raise MapboxError(f"Could not geocode: {query!r}")
    feat = features[0]
    lng, lat = feat["center"]
    return Place(label=feat.get("place_name") or query, lng=float(lng), lat=float(lat))


def directions(origin: Place, destination: Place) -> list[RawRoute]:
    """Return up to 3 driving routes. Does not invent extras if API returns fewer."""
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
    data = resp.json()
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


def _route_summary(route: dict[str, Any], index: int) -> str:
    legs = route.get("legs") or []
    if legs and legs[0].get("summary"):
        return str(legs[0]["summary"])
    labels = ["Primary", "Alternative A", "Alternative B"]
    return labels[index] if index < len(labels) else f"Route {index + 1}"


def suggest_places(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Lightweight autocomplete for the frontend."""
    if not query or len(query.strip()) < 2:
        return []
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
