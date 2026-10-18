from django.urls import path

from routing.views import AnalyzeView, GeocodeSuggestView

urlpatterns = [
    path("analyze/", AnalyzeView.as_view(), name="analyze"),
    path("geocode/", GeocodeSuggestView.as_view(), name="geocode"),
]
