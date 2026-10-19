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
    """Explain which preference criterion beat the alternatives."""
    if not others:
        return "Only available route."

    best_severe = min(o.severe_miles for o in others)
    if metrics.severe_miles < best_severe:
        return f"Fewest severe miles ({metrics.severe_miles:.0f} vs {best_severe:.0f})"

    tied = [o for o in others if o.severe_miles == metrics.severe_miles]
    best_high = min(o.high_miles for o in tied)
    if metrics.high_miles < best_high:
        return f"Tied on severe; fewest high miles ({metrics.high_miles:.0f} vs {best_high:.0f})"

    tied = [o for o in tied if o.high_miles == metrics.high_miles]
    best_avg = min(o.avg_risk for o in tied)
    if metrics.avg_risk < best_avg:
        return f"Tied on severe/high; lowest avg risk ({metrics.avg_risk:.2f} vs {best_avg:.2f})"

    tied = [o for o in tied if o.avg_risk == metrics.avg_risk]
    best_time = min(o.travel_time_minutes for o in tied)
    return (
        f"Tied on risk metrics; shortest time "
        f"({metrics.travel_time_minutes:.0f} vs {best_time:.0f} min)"
    )
