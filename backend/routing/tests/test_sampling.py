from datetime import datetime, timezone

from routing.services.metrics import ScoredCheckpoint, compute_metrics
from routing.services.sampling import sample_checkpoints


def _line_east(miles_approx=100):
    """Rough eastbound line near 40N; ~1 deg lon ≈ 53 miles at 40N."""
    # Use many points for smoother sampling
    start_lng = -100.0
    # ~100 miles ≈ 1.88 deg longitude at lat 40
    end_lng = start_lng + (miles_approx / 53.0)
    n = 20
    return [
        [start_lng + (end_lng - start_lng) * i / n, 40.0]
        for i in range(n + 1)
    ]


class TestSampling:
    def test_interval_and_endpoints(self):
        geom = _line_east(100)
        departure = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        cps = sample_checkpoints(
            geom,
            total_miles=100,
            duration_minutes=120,
            departure_at=departure,
            interval_miles=25,
        )
        miles = [c.mile for c in cps]
        assert miles[0] == 0.0
        assert miles[-1] == 100.0
        assert 25 in miles
        assert 50 in miles
        assert 75 in miles

    def test_eta_scales_with_distance(self):
        geom = _line_east(100)
        departure = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        cps = sample_checkpoints(
            geom,
            total_miles=100,
            duration_minutes=100,
            departure_at=departure,
            interval_miles=50,
        )
        mid = next(c for c in cps if c.mile == 50)
        assert mid.eta.hour == 8
        assert mid.eta.minute == 50  # halfway through 100 minutes


class TestMetricsAttribution:
    def test_segment_attributed_to_arrival_checkpoint(self):
        # 0 low → 50 high → 100 severe  ⇒ 50 high miles + 50 severe miles
        cps = [
            ScoredCheckpoint(0, "low", 1),
            ScoredCheckpoint(50, "high", 3),
            ScoredCheckpoint(100, "severe", 4),
        ]
        m = compute_metrics(cps, duration_minutes=120, total_miles=100)
        assert m.high_miles == 50
        assert m.severe_miles == 50
        assert m.avg_risk == (50 * 3 + 50 * 4) / 100
