from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from routing.serializers import AnalyzeInputSerializer
from routing.services.geo import RoutingError, suggest_places
from routing.services.planner import AnalyzeInput, analyze
from routing.services.weather import WeatherError


class AnalyzeView(APIView):
    """POST /api/analyze/ — full weather-aware route analysis."""

    def post(self, request):
        serializer = AnalyzeInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        origin_coords = data.get("origin_coords")
        dest_coords = data.get("destination_coords")

        try:
            result = analyze(
                AnalyzeInput(
                    origin=data["origin"],
                    destination=data["destination"],
                    departure_at=data["departure_at"],
                    load_weight_lb=data["load_weight_lb"],
                    sample_interval_miles=int(data["sample_interval_miles"]),
                    origin_coords=tuple(origin_coords) if origin_coords else None,
                    destination_coords=tuple(dest_coords) if dest_coords else None,
                )
            )
        except RoutingError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        except WeatherError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        return Response(result, status=status.HTTP_200_OK)


class GeocodeSuggestView(APIView):
    """GET /api/geocode/?q= — autocomplete helper for the form."""

    def get(self, request):
        q = request.query_params.get("q", "")
        try:
            results = suggest_places(q)
        except RoutingError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        return Response({"results": results})
