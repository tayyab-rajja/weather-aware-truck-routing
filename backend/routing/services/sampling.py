"""
Sample checkpoints along a route polyline every N miles.

ETA at mile M uses distance fraction × total duration:
  eta = departure + (M / total_miles) * duration_minutes
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Sequence

# Earth radius in miles
_EARTH_MI = 3958.7613


@dataclass(frozen=True)
class Checkpoint:
    mile: float
    lng: float
    lat: float
    eta: datetime


def _haversine_miles(lng1: float, lat1: float, lng2: float, lat2: float) -> float:
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * _EARTH_MI * math.asin(min(1.0, math.sqrt(a)))


def _interpolate(
    lng1: float, lat1: float, lng2: float, lat2: float, fraction: float
) -> tuple[float, float]:
    return lng1 + (lng2 - lng1) * fraction, lat1 + (lat2 - lat1) * fraction


def sample_checkpoints(
    geometry: Sequence[Sequence[float]],
    *,
    total_miles: float,
    duration_minutes: float,
    departure_at: datetime,
    interval_miles: float,
) -> list[Checkpoint]:
    """
    Walk the [lng, lat] polyline and emit checkpoints at 0, interval, 2*interval, ...
    and always include the destination (total_miles).
    """
    if not geometry or len(geometry) < 2:
        raise ValueError("geometry must have at least two coordinates")
    if interval_miles <= 0:
        raise ValueError("interval_miles must be positive")
    if total_miles <= 0:
        # Degenerate: origin == destination
        return [
            Checkpoint(
                mile=0.0,
                lng=float(geometry[0][0]),
                lat=float(geometry[0][1]),
                eta=departure_at,
            )
        ]

    # Build cumulative distance along the polyline.
    coords = [(float(p[0]), float(p[1])) for p in geometry]
    seg_lens: list[float] = []
    for i in range(len(coords) - 1):
        seg_lens.append(_haversine_miles(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]))
    poly_miles = sum(seg_lens) or total_miles
    # Scale polyline distances to reported route distance.
    scale = total_miles / poly_miles

    targets: list[float] = [0.0]
    m = interval_miles
    while m < total_miles - 1e-6:
        targets.append(round(m, 4))
        m += interval_miles
    if targets[-1] < total_miles - 1e-6:
        targets.append(round(total_miles, 4))

    checkpoints: list[Checkpoint] = []
    cum = 0.0
    seg_i = 0

    for target in targets:
        target_poly = target / scale if scale else target
        while seg_i < len(seg_lens) - 1 and cum + seg_lens[seg_i] < target_poly - 1e-9:
            cum += seg_lens[seg_i]
            seg_i += 1

        if seg_i >= len(seg_lens):
            lng, lat = coords[-1]
        else:
            remaining = target_poly - cum
            length = seg_lens[seg_i] or 1e-9
            frac = min(1.0, max(0.0, remaining / length))
            lng, lat = _interpolate(
                coords[seg_i][0], coords[seg_i][1], coords[seg_i + 1][0], coords[seg_i + 1][1], frac
            )

        frac_trip = target / total_miles
        eta = departure_at + timedelta(minutes=duration_minutes * frac_trip)
        checkpoints.append(Checkpoint(mile=round(target, 2), lng=lng, lat=lat, eta=eta))

    return checkpoints
