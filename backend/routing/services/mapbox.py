"""Backward-compatible re-exports — prefer ``routing.services.geo``. """
from routing.services.geo import (  # noqa: F401
    Place,
    RawRoute,
    RoutingError as MapboxError,
    directions,
    geocode,
    suggest_places,
)
