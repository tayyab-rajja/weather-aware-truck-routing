from routing.services.metrics import RouteMetrics
from routing.services.recommend import pick_recommended, recommendation_key


def _m(severe=0, high=0, avg=1.0, time=100, miles=100, no_travel=0):
    return RouteMetrics(
        severe_miles=severe,
        high_miles=high,
        no_travel_miles=no_travel,
        avg_risk=avg,
        travel_time_minutes=time,
        total_miles=miles,
    )


class TestRecommend:
    def test_fewest_severe_wins(self):
        routes = [
            ("a", _m(severe=10, high=0, avg=1, time=60)),
            ("b", _m(severe=2, high=50, avg=3, time=200)),
        ]
        assert pick_recommended(routes) == "b"

    def test_then_fewest_high(self):
        routes = [
            ("a", _m(severe=5, high=20, avg=1, time=60)),
            ("b", _m(severe=5, high=5, avg=3, time=200)),
        ]
        assert pick_recommended(routes) == "b"

    def test_then_lowest_avg_risk(self):
        routes = [
            ("a", _m(severe=5, high=5, avg=2.5, time=60)),
            ("b", _m(severe=5, high=5, avg=1.5, time=200)),
        ]
        assert pick_recommended(routes) == "b"

    def test_then_shortest_time(self):
        routes = [
            ("a", _m(severe=5, high=5, avg=2.0, time=180)),
            ("b", _m(severe=5, high=5, avg=2.0, time=90)),
        ]
        assert pick_recommended(routes) == "b"

    def test_empty(self):
        assert pick_recommended([]) is None

    def test_key_ordering(self):
        assert recommendation_key(_m(severe=1)) < recommendation_key(_m(severe=2))
