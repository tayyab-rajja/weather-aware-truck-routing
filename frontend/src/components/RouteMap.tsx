import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AnalyzeResponse, RiskLevel, RouteResult } from "../types";
import { RISK_COLORS, RISK_LABELS, scoreToColor } from "../lib/riskColors";

const ROUTE_COLORS = ["#264653", "#2a9d8f", "#457b9d"];

interface Props {
  data: AnalyzeResponse | null;
  selectedId: string | null;
  forecastHour: number;
}

export function RouteMap({ data, selectedId, forecastHour }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-87.6, 41.8],
      zoom: 5,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "280px" });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const apply = () => {
      upsertHeatmap(map, data, forecastHour);
      upsertRoutes(map, data.routes, selectedId);
      upsertRouteLabels(map, data.routes, selectedId);
      upsertCheckpoints(map, data, selectedId, popupRef.current);
      fitToRoutes(map, data.routes);
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !map.getSource("heatmap")) return;
    upsertHeatmap(map, data, forecastHour);
  }, [data, forecastHour]);

  return <div className="map-root" ref={containerRef} />;
}

function upsertRoutes(map: Map, routes: RouteResult[], selectedId: string | null) {
  const features = routes.map((r, i) => ({
    type: "Feature" as const,
    properties: {
      id: r.id,
      recommended: r.is_recommended,
      selected: r.id === selectedId,
      color: r.is_recommended ? "#e76f51" : ROUTE_COLORS[i % ROUTE_COLORS.length],
      width: r.id === selectedId || r.is_recommended ? 6 : 3.5,
      opacity: selectedId && r.id !== selectedId ? 0.45 : 0.95,
      label: `${r.summary} · ${r.distance_miles.toFixed(0)} mi · ${fmtMin(r.duration_minutes)}`,
    },
    geometry: {
      type: "LineString" as const,
      coordinates: r.geometry,
    },
  }));

  const geojson = { type: "FeatureCollection" as const, features };

  if (map.getSource("routes")) {
    (map.getSource("routes") as maplibregl.GeoJSONSource).setData(geojson);
  } else {
    map.addSource("routes", { type: "geojson", data: geojson });
    map.addLayer({
      id: "routes-line",
      type: "line",
      source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["get", "width"],
        "line-opacity": ["get", "opacity"],
      },
    });
  }
}

function upsertRouteLabels(map: Map, routes: RouteResult[], selectedId: string | null) {
  const features = routes.map((r, i) => {
    const mid = r.geometry[Math.floor(r.geometry.length / 2)] || r.geometry[0];
    return {
      type: "Feature" as const,
      properties: {
        label: `${r.summary}${r.is_recommended ? " ★" : ""}`,
        detail: `${r.distance_miles.toFixed(0)} mi · ${fmtMin(r.duration_minutes)} · risk ${r.metrics.avg_risk.toFixed(2)}`,
        color: r.is_recommended ? "#e76f51" : ROUTE_COLORS[i % ROUTE_COLORS.length],
        selected: r.id === selectedId || r.is_recommended,
      },
      geometry: { type: "Point" as const, coordinates: mid },
    };
  });

  const geojson = { type: "FeatureCollection" as const, features };

  if (map.getSource("route-labels")) {
    (map.getSource("route-labels") as maplibregl.GeoJSONSource).setData(geojson);
  } else {
    map.addSource("route-labels", { type: "geojson", data: geojson });
    map.addLayer({
      id: "route-labels-text",
      type: "symbol",
      source: "route-labels",
      layout: {
        "text-field": ["format", ["get", "label"], "\n", ["get", "detail"]],
        "text-size": 12,
        "text-offset": [0, -1.2],
        "text-anchor": "bottom",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": ["get", "color"],
        "text-halo-color": "#fffdf8",
        "text-halo-width": 1.5,
      },
    });
  }
}

function upsertCheckpoints(
  map: Map,
  data: AnalyzeResponse,
  selectedId: string | null,
  popup: Popup | null,
) {
  // Show checkpoints for ALL routes; emphasize the selected/recommended one
  const features = data.routes.flatMap((route) => {
    const focused =
      route.id === (selectedId || data.recommended_route_id || data.routes[0]?.id);

    return route.checkpoints.map((c) => ({
      type: "Feature" as const,
      properties: {
        routeId: route.id,
        routeSummary: route.summary,
        mile: c.mile,
        risk: c.risk,
        color: RISK_COLORS[c.risk as RiskLevel],
        eta: c.eta,
        wind: c.weather.wind_mph,
        rain: c.weather.rain_in_hr,
        snow: c.weather.snow_in_hr,
        reasons: c.risk_reasons.join("; "),
        radius: focused ? 7 : 4,
        opacity: focused ? 1 : 0.55,
        stroke: focused ? 2 : 1,
      },
      geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
    }));
  });

  const geojson = { type: "FeatureCollection" as const, features };

  if (map.getSource("checkpoints")) {
    (map.getSource("checkpoints") as maplibregl.GeoJSONSource).setData(geojson);
  } else {
    map.addSource("checkpoints", { type: "geojson", data: geojson });
    map.addLayer({
      id: "checkpoints-circle",
      type: "circle",
      source: "checkpoints",
      paint: {
        "circle-radius": ["get", "radius"],
        "circle-color": ["get", "color"],
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-width": ["get", "stroke"],
        "circle-stroke-color": "#fff",
      },
    });

    map.on("click", "checkpoints-circle", (e) => {
      const f = e.features?.[0];
      if (!f || !popup) return;
      const p = f.properties!;
      const coords = (f.geometry as { coordinates: [number, number] }).coordinates;
      popup
        .setLngLat(coords)
        .setHTML(
          `<strong>${p.routeSummary} · Mile ${Number(p.mile).toFixed(0)}</strong><br/>
           Risk: ${RISK_LABELS[p.risk as RiskLevel] || p.risk}<br/>
           ETA: ${new Date(p.eta).toLocaleString()}<br/>
           Wind ${p.wind} mph · Rain ${p.rain} in/hr · Snow ${p.snow} in/hr<br/>
           <em>${p.reasons}</em>`,
        )
        .addTo(map);
    });
    map.on("mouseenter", "checkpoints-circle", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "checkpoints-circle", () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function upsertHeatmap(map: Map, data: AnalyzeResponse, hour: number) {
  const features = data.heatmap.points.map((p) => {
    const slot = p.hours.find((h) => h.hour_offset === hour) || p.hours[0];
    const score = slot?.score ?? 1;
    return {
      type: "Feature" as const,
      properties: { score, weight: score },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    };
  });

  const geojson = { type: "FeatureCollection" as const, features };

  if (map.getSource("heatmap")) {
    (map.getSource("heatmap") as maplibregl.GeoJSONSource).setData(geojson);
  } else {
    map.addSource("heatmap", { type: "geojson", data: geojson });
    map.addLayer({
      id: "heatmap-layer",
      type: "heatmap",
      source: "heatmap",
      maxzoom: 12,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 1, 0.2, 5, 1],
        "heatmap-intensity": 1.2,
        "heatmap-radius": 28,
        "heatmap-opacity": 0.65,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(42,157,143,0)",
          0.2,
          scoreToColor(1),
          0.4,
          scoreToColor(2),
          0.6,
          scoreToColor(3),
          0.8,
          scoreToColor(4),
          1,
          scoreToColor(5),
        ],
      },
    });
  }
}

function fitToRoutes(map: Map, routes: RouteResult[]) {
  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const r of routes) {
    for (const c of r.geometry) {
      bounds.extend(c as [number, number]);
      any = true;
    }
  }
  if (any) {
    map.fitBounds(bounds, { padding: 56, maxZoom: 8, duration: 600 });
  }
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
