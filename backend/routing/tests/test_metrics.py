from routing.services.metrics import ScoredCheckpoint, compute_metrics


class TestMetrics:
    def test_no_travel_counts_toward_severe_miles(self):
        cps = [
            ScoredCheckpoint(mile=0, risk="low", score=1),
            ScoredCheckpoint(mile=50, risk="no_travel", score=5),
            ScoredCheckpoint(mile=100, risk="high", score=3),
        ]
        m = compute_metrics(cps, duration_minutes=120, total_miles=100)
        assert m.no_travel_miles == 50
        assert m.severe_miles == 50  # no_travel folded into severe for ranking
        assert m.high_miles == 50

    def test_arrival_checkpoint_owns_segment(self):
        cps = [
            ScoredCheckpoint(mile=0, risk="severe", score=4),
            ScoredCheckpoint(mile=40, risk="low", score=1),
        ]
        m = compute_metrics(cps, duration_minutes=60, total_miles=40)
        assert m.severe_miles == 0
        assert m.avg_risk == 1.0
