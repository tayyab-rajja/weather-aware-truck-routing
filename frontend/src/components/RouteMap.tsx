/**
 * Map patterned after RoadWatch-ELD MapView:
 *  - raster basemap (always visible, no API key)
 *  - ResizeObserver + nudge() so the GL canvas fills the panel
 *  - GSAP draw-on for route polylines
 *  - DOM markers for checkpoints (no map text labels)
 */
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import gsap from "gsap";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AnalyzeResponse, RiskLevel, RouteResult } from "../types";
import { RISK_COLORS, RISK_LABELS } from "../lib/riskColors";
import "./RouteMap.css";

const ROUTE_COLORS = ["#0f766e", "#2563eb", "#7c3aed"];
const RECOMMENDED = "#ea580c";

/**
 * Free raster basemap — no API key.
 * Esri World Street Map public tiles (roads + cities). Note z/y/x order.
 */
const BASEMAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    streets: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri",
    },
  },
  layers: [{ id: "streets", type: "raster", source: "streets" }],
};

interface Props {
  data: AnalyzeResponse | null;
  selectedId: string | null;
  forecastHour: number;
}

export function RouteMap({ data, selectedId, forecastHour }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const markersRef = useRef<Marker[]>([]);
  const tweensRef = useRef<gsap.core.Tween[]>([]);
  const lastTripKey = useRef<string>("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");

  // Create map once — always show basemap at start (RoadWatch pattern)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-87.6, 41.8],
      zoom: 5.2,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      readyRef.current = true;
      setPhase("ready");
      ensureHeatSource(map);
      nudge(map);
    });
    map.on("error", (e) => {
      console.error("[map]", e.error);
      // Don't blank the UI for a single tile error
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    const safety = window.setTimeout(() => {
      readyRef.current = true;
      setPhase((p) => (p === "loading" ? "ready" : p));
      map.resize();
    }, 2000);

    return () => {
      window.clearTimeout(safety);
      observer.disconnect();
      killTweens(tweensRef.current);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw routes when analysis data arrives / selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data?.routes.length) return;

    const tripKey = data.routes.map((r) => `${r.id}:${r.distance_miles}`).join("|");
    const isNewTrip = tripKey !== lastTripKey.current;

    const render = () => {
      ensureHeatSource(map);
      updateHeatmap(map, data, forecastHour);

      if (isNewTrip) {
        lastTripKey.current = tripKey;
        killTweens(tweensRef.current);
        tweensRef.current = drawRoutesAnimated(map, data.routes, selectedId);
        fitToRoutes(map, data.routes);
      } else {
        restyleRoutes(map, data.routes, selectedId);
      }

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = addCheckpointMarkers(map, data, selectedId);
      nudge(map);
    };

    if (readyRef.current) render();
    else map.once("load", render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedId]);

  // Fast heatmap-only updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !readyRef.current || !map.getSource("heatmap")) return;
    updateHeatmap(map, data, forecastHour);
  }, [data, forecastHour]);

  return (
    <div className="route-map">
      <div ref={containerRef} className="route-map__canvas" />
      {phase === "loading" && (
        <div className="route-map__overlay">
          <span className="route-map__spinner" />
          Loading map…
        </div>
      )}
    </div>
  );
}

function ensureHeatSource(map: MlMap) {
  if (map.getSource("heatmap")) return;
  map.addSource("heatmap", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "heatmap-layer",
    type: "heatmap",
    source: "heatmap",
    maxzoom: 12,
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 1, 0.2, 5, 1],
      "heatmap-intensity": 0.85,
      "heatmap-radius": 26,
      "heatmap-opacity": 0.4,
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(15,118,110,0)",
        0.3,
        "rgba(15,118,110,0.4)",
        0.55,
        "rgba(234,179,8,0.55)",
        0.75,
        "rgba(234,88,12,0.65)",
        1,
        "rgba(153,27,27,0.8)",
      ],
    },
  });
}

/** One source + casing/line layer per route — fixed paints like RoadWatch */
function drawRoutesAnimated(
  map: MlMap,
  routes: RouteResult[],
  selectedId: string | null,
): gsap.core.Tween[] {
  // Clear previous route layers
  for (let i = 0; i < 6; i++) {
    const id = `route-${i}`;
    if (map.getLayer(`${id}-casing`)) map.removeLayer(`${id}-casing`);
    if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
    if (map.getSource(id)) map.removeSource(id);
  }

  const tweens: gsap.core.Tween[] = [];

  routes.forEach((route, i) => {
    const id = `route-${i}`;
    const color = route.is_recommended ? RECOMMENDED : ROUTE_COLORS[i % ROUTE_COLORS.length];
    const focused = route.id === selectedId || route.is_recommended;
    const width = focused ? 5.5 : 3.5;
    const opacity = selectedId && route.id !== selectedId ? 0.35 : 0.95;
    const coords = route.geometry as [number, number][];

    map.addSource(id, { type: "geojson", data: lineFeature(coords.slice(0, 2)) });

    map.addLayer({
      id: `${id}-casing`,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": width + 4,
        "line-opacity": 0.85,
        "line-blur": 0.2,
      },
    });
    map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": color,
        "line-width": width,
        "line-opacity": opacity,
        "line-blur": 0.35,
      },
    });

    // Move route layers above heatmap
    if (map.getLayer("heatmap-layer")) {
      try {
        map.moveLayer(`${id}-casing`);
        map.moveLayer(`${id}-line`);
      } catch {
        /* ignore */
      }
    }

    const source = map.getSource(id) as GeoJSONSource;
    const progress = { n: 2 };
    const tween = gsap.to(progress, {
      n: coords.length,
      duration: 1.35,
      delay: i * 0.12,
      ease: "power2.inOut",
      onUpdate: () => {
        const n = Math.max(2, Math.round(progress.n));
        source.setData(lineFeature(coords.slice(0, n)));
      },
      onComplete: () => source.setData(lineFeature(coords)),
    });
    tweens.push(tween);
  });

  return tweens;
}

function restyleRoutes(map: MlMap, routes: RouteResult[], selectedId: string | null) {
  routes.forEach((route, i) => {
    const id = `route-${i}`;
    if (!map.getLayer(`${id}-line`)) return;
    const color = route.is_recommended ? RECOMMENDED : ROUTE_COLORS[i % ROUTE_COLORS.length];
    const focused = route.id === selectedId || route.is_recommended;
    const width = focused ? 5.5 : 3.5;
    const opacity = selectedId && route.id !== selectedId ? 0.35 : 0.95;
    map.setPaintProperty(`${id}-line`, "line-color", color);
    map.setPaintProperty(`${id}-line`, "line-width", width);
    map.setPaintProperty(`${id}-line`, "line-opacity", opacity);
    map.setPaintProperty(`${id}-casing`, "line-width", width + 4);
  });
}

function addCheckpointMarkers(
  map: MlMap,
  data: AnalyzeResponse,
  selectedId: string | null,
): Marker[] {
  const focusId = selectedId || data.recommended_route_id || data.routes[0]?.id;
  const markers: Marker[] = [];

  for (const route of data.routes) {
    const focused = route.id === focusId;
    for (const cp of route.checkpoints) {
      const el = document.createElement("div");
      el.className = focused ? "map-cp" : "map-cp map-cp--dim";
      el.style.setProperty("--cp-color", RISK_COLORS[cp.risk as RiskLevel]);
      el.title = `${route.summary} · mi ${cp.mile}`;

      const popup = new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(
        `<div class="map-popup">
          <strong>${escapeHtml(route.summary)} · mi ${cp.mile.toFixed(0)}</strong>
          <span>Risk: ${RISK_LABELS[cp.risk]}</span>
          <span class="map-popup__meta">${new Date(cp.eta).toLocaleString()}</span>
          <span class="map-popup__meta">Wind ${cp.weather.wind_mph} · Rain ${cp.weather.rain_in_hr} · Snow ${cp.weather.snow_in_hr}</span>
          <span class="map-popup__meta">${escapeHtml((cp.risk_reasons || []).join("; "))}</span>
        </div>`,
      );

      markers.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([cp.lng, cp.lat])
          .setPopup(popup)
          .addTo(map),
      );
    }
  }
  return markers;
}

function updateHeatmap(map: MlMap, data: AnalyzeResponse, hour: number) {
  const features = data.heatmap.points.map((p) => {
    const slot = p.hours.find((h) => h.hour_offset === hour) || p.hours[0];
    return {
      type: "Feature" as const,
      properties: { score: slot?.score ?? 1 },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    };
  });
  const src = map.getSource("heatmap") as GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features });
}

function fitToRoutes(map: MlMap, routes: RouteResult[]) {
  const bounds = new maplibregl.LngLatBounds();
  let any = false;
  for (const r of routes) {
    for (const c of r.geometry) {
      bounds.extend(c as [number, number]);
      any = true;
    }
  }
  if (any) {
    map.fitBounds(bounds, { padding: 70, duration: 1100, maxZoom: 7.8 });
  }
}

function lineFeature(coords: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
}

function nudge(map: MlMap) {
  [0, 120, 400, 800].forEach((delay) =>
    window.setTimeout(() => {
      if (!map.getContainer().isConnected) return;
      map.resize();
      map.triggerRepaint();
    }, delay),
  );
}

function killTweens(tweens: gsap.core.Tween[]) {
  tweens.forEach((t) => t.kill());
  tweens.length = 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
