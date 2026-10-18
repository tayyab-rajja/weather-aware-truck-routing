"""
Recommend the safest route.

Preference order (strict lexicographic):
  1. Fewest Severe miles (includes no_travel miles counted as severe)
  2. Fewest High miles
  3. Lowest average risk
  4. Shortest travel time
"""
from __future__ import annotations

from typing import Sequence, TypeVar

from routing.services.metrics import RouteMetrics

T = TypeVar("T")


def recommendation_key(metrics: RouteMetrics) -> tuple:
    return (
        metrics.severe_miles,
        metrics.high_miles,
        metrics.avg_risk,
        metrics.travel_time_minutes,
    )


def pick_recommended(routes: Sequence[tuple[T, RouteMetrics]]) -> T | None:
    """Return the id/object of the best route, or None if empty."""
    if not routes:
        return None
    best_obj, _ = min(routes, key=lambda pair: recommendation_key(pair[1]))
    return best_obj


def why_recommended(metrics: RouteMetrics, others: Sequence[RouteMetrics]) -> str:
    """Short human-readable reason for the UI."""
    if not others:
        return "Only available route."
    return (
        f"Fewest severe miles ({metrics.severe_miles:.0f}), "
        f"then fewest high ({metrics.high_miles:.0f}), "
        f"avg risk {metrics.avg_risk:.2f}, "
        f"{metrics.travel_time_minutes:.0f} min"
    )
