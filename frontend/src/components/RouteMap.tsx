/**
 * Map implementation mirrored from RoadWatch-ELD MapView:
 * mapbox-gl + ResizeObserver + nudge() + GSAP draw-on + DOM markers.
 * Routes are ALWAYS (re)drawn when data is present — fixes Strict Mode skip bug.
 */
import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import gsap from "gsap";
import "mapbox-gl/dist/mapbox-gl.css";
import type { AnalyzeResponse, RiskLevel, RouteResult } from "../types";
import { RISK_COLORS, RISK_LABELS } from "../lib/riskColors";
import "./RouteMap.css";

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || "";

const ROUTE_COLORS = ["#f4a338", "#38d4e0", "#a78bfa"];
const RECOMMENDED = "#f4a338";

/** Free raster style when no Mapbox token — Esri public tiles (no key) */
const FREE_STYLE: mapboxgl.Style = {
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
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const readyRef = useRef(false);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const tweensRef = useRef<gsap.core.Tween[]>([]);
  const drawnTripRef = useRef<string>("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Create map once (RoadWatch pattern)
  useEffect(() => {
    if (!containerRef.current) return;

    // mapbox-gl requires a token string even for custom styles
    mapboxgl.accessToken = TOKEN || "pk.local-free-basemap";

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: TOKEN ? "mapbox://styles/mapbox/dark-v11" : FREE_STYLE,
        center: [-87.6, 41.8],
        zoom: 5.2,
        attributionControl: false,
      });
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Map failed to initialize.");
      return;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      readyRef.current = true;
      setPhase("ready");
      // Force redraw after remount (Strict Mode) — clear drawn key
      drawnTripRef.current = "";
      nudge(map);
    });
    map.on("error", (e) => {
      const message = e.error?.message ?? "Map error";
      // Ignore tile 404 noise; surface auth problems
      if (/token|403|401|unauthorized/i.test(message)) {
        console.error("[mapbox]", message);
        setPhase("error");
        setErrorMsg(message);
      }
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    const safety = window.setTimeout(() => {
      readyRef.current = true;
      setPhase((p) => (p === "loading" ? "ready" : p));
      map.resize();
    }, 2500);

    return () => {
      window.clearTimeout(safety);
      observer.disconnect();
      killTweens(tweensRef.current);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      readyRef.current = false;
      drawnTripRef.current = "";
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw routes whenever trip data / selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data?.routes.length) return;

    const tripKey = data.routes.map((r) => `${r.id}:${r.geometry.length}:${r.distance_miles}`).join("|");

    const render = () => {
      if (!map.getStyle()) return;

      ensureHeatLayer(map);
      updateHeatmap(map, data, forecastHour);

      // Always (re)draw if layers missing — fixes React Strict Mode remount
      const missingRoutes = !map.getLayer("route-0-line");
      const isNewTrip = tripKey !== drawnTripRef.current;

      if (isNewTrip || missingRoutes) {
        drawnTripRef.current = tripKey;
        killTweens(tweensRef.current);
        clearRouteLayers(map);
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
    // forecastHour intentionally omitted — updated in separate effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedId]);

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
      {phase === "error" && (
        <div className="route-map__overlay route-map__overlay--error">
          <strong>Map couldn't load</strong>
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}

function ensureHeatLayer(map: mapboxgl.Map) {
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
      "heatmap-intensity": 0.7,
      "heatmap-radius": 24,
      "heatmap-opacity": 0.35,
      "heatmap-color": [
        "interpolate",
        ["linear"],
        ["heatmap-density"],
        0,
        "rgba(244,163,56,0)",
        0.4,
        "rgba(244,163,56,0.35)",
        0.7,
        "rgba(231,111,81,0.55)",
        1,
        "rgba(155,34,38,0.75)",
      ],
    },
  });
}

function clearRouteLayers(map: mapboxgl.Map) {
  for (let i = 0; i < 6; i++) {
    const id = `route-${i}`;
    if (map.getLayer(`${id}-casing`)) map.removeLayer(`${id}-casing`);
    if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
    if (map.getSource(id)) map.removeSource(id);
  }
}

function drawRoutesAnimated(
  map: mapboxgl.Map,
  routes: RouteResult[],
  selectedId: string | null,
): gsap.core.Tween[] {
  const tweens: gsap.core.Tween[] = [];

  routes.forEach((route, i) => {
    const id = `route-${i}`;
    const coords = normalizeCoords(route.geometry);
    if (coords.length < 2) return;

    const focused = route.id === selectedId || route.is_recommended;
    const color = route.is_recommended ? RECOMMENDED : ROUTE_COLORS[i % ROUTE_COLORS.length];
    // Selected / recommended: thick and bright (RoadWatch-like)
    const width = focused ? 7 : 4;
    const opacity = selectedId && route.id !== selectedId ? 0.28 : 0.95;

    // Show FULL line immediately so routes are never invisible
    map.addSource(id, { type: "geojson", data: lineFeature(coords) });

    map.addLayer({
      id: `${id}-casing`,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#0a0e14",
        "line-width": width + 5,
        "line-opacity": 0.55,
        "line-blur": 0.3,
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
        "line-blur": 0.4,
      },
    });

    // Keep lines above heatmap
    if (map.getLayer("heatmap-layer")) {
      try {
        map.moveLayer(`${id}-casing`);
        map.moveLayer(`${id}-line`);
      } catch {
        /* ignore */
      }
    }

    // GSAP draw-on polish (RoadWatch) — starts from short slice then fills
    const source = map.getSource(id) as mapboxgl.GeoJSONSource;
    const progress = { n: 2 };
    const tween = gsap.fromTo(
      progress,
      { n: 2 },
      {
        n: coords.length,
        duration: 1.5,
        delay: i * 0.1,
        ease: "power2.inOut",
        onUpdate: () => {
          const n = Math.max(2, Math.round(progress.n));
          source.setData(lineFeature(coords.slice(0, n)));
        },
        onComplete: () => source.setData(lineFeature(coords)),
      },
    );
    tweens.push(tween);
  });

  return tweens;
}

function restyleRoutes(map: mapboxgl.Map, routes: RouteResult[], selectedId: string | null) {
  routes.forEach((route, i) => {
    const id = `route-${i}`;
    if (!map.getLayer(`${id}-line`)) return;
    const focused = route.id === selectedId || route.is_recommended;
    const color = route.is_recommended ? RECOMMENDED : ROUTE_COLORS[i % ROUTE_COLORS.length];
    const width = focused ? 7 : 4;
    const opacity = selectedId && route.id !== selectedId ? 0.28 : 0.95;
    map.setPaintProperty(`${id}-line`, "line-color", color);
    map.setPaintProperty(`${id}-line`, "line-width", width);
    map.setPaintProperty(`${id}-line`, "line-opacity", opacity);
    map.setPaintProperty(`${id}-casing`, "line-width", width + 5);
  });
}

function addCheckpointMarkers(
  map: mapboxgl.Map,
  data: AnalyzeResponse,
  selectedId: string | null,
): mapboxgl.Marker[] {
  const focusId = selectedId || data.recommended_route_id || data.routes[0]?.id;
  const markers: mapboxgl.Marker[] = [];

  for (const route of data.routes) {
    const focused = route.id === focusId;
    // Only show focused route checkpoints densely; others dim
    for (const cp of route.checkpoints) {
      const el = document.createElement("div");
      el.className = focused ? "map-cp" : "map-cp map-cp--dim";
      el.style.setProperty("--cp-color", RISK_COLORS[cp.risk as RiskLevel]);

      const popup = new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
        `<div class="map-popup">
          <strong>${escapeHtml(route.summary)} · mi ${cp.mile.toFixed(0)}</strong>
          <span>Risk: ${RISK_LABELS[cp.risk]}</span>
          <span class="map-popup__meta">${new Date(cp.eta).toLocaleString()}</span>
          <span class="map-popup__meta">Wind ${cp.weather.wind_mph} mph · Rain ${cp.weather.rain_in_hr} · Snow ${cp.weather.snow_in_hr}</span>
        </div>`,
      );

      markers.push(
        new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([cp.lng, cp.lat])
          .setPopup(popup)
          .addTo(map),
      );
    }
  }
  return markers;
}

function updateHeatmap(map: mapboxgl.Map, data: AnalyzeResponse, hour: number) {
  const features = data.heatmap.points.map((p) => {
    const slot = p.hours.find((h) => h.hour_offset === hour) || p.hours[0];
    return {
      type: "Feature" as const,
      properties: { score: slot?.score ?? 1 },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    };
  });
  const src = map.getSource("heatmap") as mapboxgl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features });
}

function fitToRoutes(map: mapboxgl.Map, routes: RouteResult[]) {
  const all = routes.flatMap((r) => normalizeCoords(r.geometry));
  if (!all.length) return;
  const bounds = all.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(all[0], all[0]),
  );
  map.fitBounds(bounds, { padding: 70, duration: 1200, maxZoom: 8 });
}

function normalizeCoords(geometry: number[][]): [number, number][] {
  return geometry
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [Number(c[0]), Number(c[1])] as [number, number]);
}

function lineFeature(coords: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
}

function nudge(map: mapboxgl.Map) {
  [0, 150, 450, 900].forEach((delay) =>
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
