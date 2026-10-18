from rest_framework import serializers


class AnalyzeInputSerializer(serializers.Serializer):
    origin = serializers.CharField(max_length=256)
    destination = serializers.CharField(max_length=256)
    departure_at = serializers.DateTimeField()
    load_weight_lb = serializers.FloatField(min_value=0)
    sample_interval_miles = serializers.ChoiceField(choices=[10, 25, 50])
    # Optional [lng, lat] from frontend autocomplete
    origin_coords = serializers.ListField(
        child=serializers.FloatField(), min_length=2, max_length=2, required=False
    )
    destination_coords = serializers.ListField(
        child=serializers.FloatField(), min_length=2, max_length=2, required=False
    )
