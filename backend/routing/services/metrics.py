"""
Route-level risk metrics.

Segment attribution rule (documented for reviewers):
  Miles between checkpoint[i] and checkpoint[i+1] are attributed to the risk
  level of checkpoint[i+1] (the conditions the truck arrives into on that segment).
  The first checkpoint (mile 0) contributes 0 miles by itself.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from routing.services.risk import RISK_SCORE, RiskLevel


@dataclass(frozen=True)
class RouteMetrics:
    severe_miles: float
    high_miles: float
    no_travel_miles: float
    avg_risk: float
    travel_time_minutes: float
    total_miles: float


@dataclass(frozen=True)
class ScoredCheckpoint:
    mile: float
    risk: RiskLevel
    score: int


def compute_metrics(
    checkpoints: Sequence[ScoredCheckpoint],
    *,
    duration_minutes: float,
    total_miles: float,
) -> RouteMetrics:
    severe = 0.0
    high = 0.0
    no_travel = 0.0
    weighted = 0.0
    attributed = 0.0

    for i in range(1, len(checkpoints)):
        seg = max(0.0, checkpoints[i].mile - checkpoints[i - 1].mile)
        risk = checkpoints[i].risk
        score = checkpoints[i].score
        attributed += seg
        weighted += seg * score
        if risk == "severe":
            severe += seg
        elif risk == "high":
            high += seg
        elif risk == "no_travel":
            no_travel += seg
            # No-travel is worse than severe; count toward severe_miles for ranking
            # preference #1 as "fewest Severe miles" — treat no_travel as severe+ for ranking.
            severe += seg

    avg = (weighted / attributed) if attributed > 0 else float(
        RISK_SCORE[checkpoints[0].risk] if checkpoints else 1
    )

    return RouteMetrics(
        severe_miles=round(severe, 2),
        high_miles=round(high, 2),
        no_travel_miles=round(no_travel, 2),
        avg_risk=round(avg, 3),
        travel_time_minutes=round(duration_minutes, 1),
        total_miles=round(total_miles, 2),
    )
