"""Threshold and load-override accuracy tests."""
from routing.services.risk import (
    assess_risk,
    classify_rain,
    classify_snow,
    classify_wind,
)


class TestWindThresholds:
    def test_low(self):
        assert classify_wind(24.9) == "low"

    def test_moderate_edges(self):
        assert classify_wind(25) == "moderate"
        assert classify_wind(34.9) == "moderate"

    def test_high_edges(self):
        assert classify_wind(35) == "high"
        assert classify_wind(44.9) == "high"

    def test_severe_edges(self):
        assert classify_wind(45) == "severe"
        assert classify_wind(54.9) == "severe"

    def test_no_travel(self):
        assert classify_wind(55) == "no_travel"
        assert classify_wind(80) == "no_travel"


class TestRainThresholds:
    def test_bands(self):
        assert classify_rain(0.09) == "low"
        assert classify_rain(0.10) == "moderate"
        assert classify_rain(0.25) == "high"
        assert classify_rain(0.50) == "severe"
        assert classify_rain(1.00) == "severe"
        assert classify_rain(1.01) == "no_travel"


class TestSnowThresholds:
    def test_bands(self):
        assert classify_snow(0.49) == "low"
        assert classify_snow(0.5) == "moderate"
        assert classify_snow(1.0) == "high"
        assert classify_snow(2.0) == "severe"
        assert classify_snow(3.0) == "severe"
        assert classify_snow(3.01) == "no_travel"


class TestWorstWins:
    def test_rain_beats_calm_wind(self):
        r = assess_risk(wind_mph=10, rain_in_hr=0.6, snow_in_hr=0, load_weight_lb=10000)
        assert r.risk == "severe"

    def test_snow_beats_calm(self):
        r = assess_risk(wind_mph=10, rain_in_hr=0, snow_in_hr=2.5, load_weight_lb=10000)
        assert r.risk == "severe"


class TestLoadOverrides:
    def test_wind_55_any_load(self):
        r = assess_risk(wind_mph=55, rain_in_hr=0, snow_in_hr=0, load_weight_lb=0)
        assert r.risk == "no_travel"

    def test_wind_45_54_heavy_load(self):
        r = assess_risk(wind_mph=50, rain_in_hr=0, snow_in_hr=0, load_weight_lb=30001)
        assert r.risk == "no_travel"

    def test_wind_45_54_light_load_stays_severe(self):
        r = assess_risk(wind_mph=50, rain_in_hr=0, snow_in_hr=0, load_weight_lb=30000)
        assert r.risk == "severe"

    def test_wind_35_44_very_heavy_escalates_to_severe(self):
        r = assess_risk(wind_mph=40, rain_in_hr=0, snow_in_hr=0, load_weight_lb=40001)
        assert r.risk == "severe"

    def test_wind_35_44_under_40k_stays_high(self):
        r = assess_risk(wind_mph=40, rain_in_hr=0, snow_in_hr=0, load_weight_lb=40000)
        assert r.risk == "high"

    def test_load_override_does_not_downgrade_worse_weather(self):
        # Already no_travel from rain; load rule for 35-44 should not matter
        r = assess_risk(wind_mph=40, rain_in_hr=1.5, snow_in_hr=0, load_weight_lb=50000)
        assert r.risk == "no_travel"
