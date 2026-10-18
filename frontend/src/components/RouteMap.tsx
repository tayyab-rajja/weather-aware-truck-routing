/**
 * Street map (default) + optional satellite, multi-color routes, truck scrubber.
 * Patterns from RoadWatch-ELD (mapbox-gl, GSAP draw-on, ResizeObserver/nudge).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import gsap from "gsap";
import "mapbox-gl/dist/mapbox-gl.css";
import type { AnalyzeResponse, Checkpoint, RiskLevel, RouteResult } from "../types";
import { RISK_COLORS, RISK_LABELS } from "../lib/riskColors";
import { buildRouteIndex, pointAtFraction, sliceByFraction, type LngLat } from "../lib/routeGeo";
import "./RouteMap.css";

const TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined)?.trim() || "";

type BasemapMode = "streets" | "satellite";

/** Distinct, readable route colors (blue / burnt orange / violet) */
export const ROUTE_PALETTE = ["#1d4ed8", "#c2410c", "#6d28d9"] as const;

/** Free street + satellite rasters; toggle via layer visibility (no overlay wipe). */
const FREE_STYLE: mapboxgl.Style = {
  version: 8,
  sources: {
    streets: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© CARTO © OpenStreetMap",
    },
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "© Esri",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
    },
  },
  layers: [
    { id: "basemap-streets", type: "raster", source: "streets" },
    {
      id: "basemap-satellite",
      type: "raster",
      source: "satellite",
      layout: { visibility: "none" },
    },
    {
      id: "basemap-labels",
      type: "raster",
      source: "labels",
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.85 },
    },
  ],
};

function applyFreeBasemap(map: mapboxgl.Map, mode: BasemapMode) {
  const streets = mode === "streets";
  if (!map.getLayer("basemap-streets")) return;
  map.setLayoutProperty("basemap-streets", "visibility", streets ? "visible" : "none");
  map.setLayoutProperty("basemap-satellite", "visibility", streets ? "none" : "visible");
  map.setLayoutProperty("basemap-labels", "visibility", streets ? "none" : "visible");
}

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
  const truckRef = useRef<mapboxgl.Marker | null>(null);
  const tweensRef = useRef<gsap.core.Tween[]>([]);
  const drawnTripRef = useRef("");
  const dataRef = useRef(data);
  const selectedIdRef = useRef(selectedId);
  const forecastHourRef = useRef(forecastHour);
  const appliedBasemapRef = useRef<BasemapMode | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState(0); // 0..1 along selected route
  const [basemap, setBasemap] = useState<BasemapMode>("streets");

  dataRef.current = data;
  selectedIdRef.current = selectedId;
  forecastHourRef.current = forecastHour;

  const selectedRoute = useMemo(() => {
    if (!data?.routes.length) return null;
    return (
      data.routes.find((r) => r.id === selectedId) ||
      data.routes.find((r) => r.is_recommended) ||
      data.routes[0]
    );
  }, [data, selectedId]);

  const routeIndex = useMemo(() => {
    if (!selectedRoute) return null;
    return buildRouteIndex(normalizeCoords(selectedRoute.geometry));
  }, [selectedRoute]);

  const weatherAtTruck = useMemo(() => {
    if (!selectedRoute || !routeIndex) return null;
    return nearestCheckpoint(selectedRoute.checkpoints, progress);
  }, [selectedRoute, routeIndex, progress]);

  // Create map once (streets by default)
  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = TOKEN || "pk.local-free-basemap";

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: TOKEN ? "mapbox://styles/mapbox/streets-v12" : FREE_STYLE,
        center: [-98, 39],
        zoom: 3.5,
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
      drawnTripRef.current = "";
      if (!TOKEN) applyFreeBasemap(map, "streets");
      nudge(map);
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
      truckRef.current?.remove();
      truckRef.current = null;
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Basemap toggle — free tiles flip visibility; Mapbox token swaps styles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || phase !== "ready") return;
    if (appliedBasemapRef.current === basemap) {
      if (!TOKEN) applyFreeBasemap(map, basemap);
      return;
    }

    if (!TOKEN) {
      applyFreeBasemap(map, basemap);
      appliedBasemapRef.current = basemap;
      return;
    }

    // Mapbox starts on streets — mark applied, skip redundant setStyle
    if (appliedBasemapRef.current === null && basemap === "streets") {
      appliedBasemapRef.current = "streets";
      return;
    }

    const styleUrl =
      basemap === "streets"
        ? "mapbox://styles/mapbox/streets-v12"
        : "mapbox://styles/mapbox/satellite-streets-v12";

    const nextMode = basemap;
    readyRef.current = false;
    setPhase("loading");
    map.setStyle(styleUrl);
    map.once("style.load", () => {
      appliedBasemapRef.current = nextMode;
      readyRef.current = true;
      setPhase("ready");
      drawnTripRef.current = "";
      truckRef.current?.remove();
      truckRef.current = null;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      const current = dataRef.current;
      if (current?.routes.length) {
        ensureExtraLayers(map);
        updateHeatmap(map, current, forecastHourRef.current);
        killTweens(tweensRef.current);
        clearRouteLayers(map);
        tweensRef.current = drawRoutesAnimated(map, current.routes, selectedIdRef.current);
        markersRef.current = addCheckpointMarkers(map, current, selectedIdRef.current);
        fitToRoutes(map, current.routes);
      }
      nudge(map);
    });
  }, [basemap, phase]);

  // Reset scrubber when selection / trip changes
  useEffect(() => {
    setProgress(0);
  }, [selectedId, data?.recommended_route_id]);

  // Draw routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data?.routes.length) return;

    const tripKey = data.routes.map((r) => `${r.id}:${r.geometry.length}`).join("|");

    const render = () => {
      if (!map.getStyle()) return;
      ensureExtraLayers(map);
      updateHeatmap(map, data, forecastHour);

      const missing = !map.getLayer("route-0-line");
      const isNew = tripKey !== drawnTripRef.current;

      if (isNew || missing) {
        drawnTripRef.current = tripKey;
        killTweens(tweensRef.current);
        clearRouteLayers(map);
        tweensRef.current = drawRoutesAnimated(map, data.routes, selectedId);
        // Auto-zoom to trip corridor
        window.setTimeout(() => fitToRoutes(map, data.routes), 80);
        window.setTimeout(() => fitToRoutes(map, data.routes), 700);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !readyRef.current || !map.getSource("heatmap")) return;
    updateHeatmap(map, data, forecastHour);
  }, [data, forecastHour]);

  // Truck + traveled path when scrubbing
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !selectedRoute || !routeIndex) return;

    const lngLat = pointAtFraction(routeIndex, progress);
    const traveled = sliceByFraction(routeIndex, 0, progress);

    const traveledSrc = map.getSource("traveled") as mapboxgl.GeoJSONSource | undefined;
    if (traveledSrc) {
      traveledSrc.setData(
        lineFeature(traveled.length >= 2 ? traveled : [lngLat, lngLat]),
      );
    }

    if (!truckRef.current) {
      const el = document.createElement("div");
      el.className = "map-truck";
      el.textContent = "🚛";
      truckRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      truckRef.current.setLngLat(lngLat);
    }
  }, [selectedRoute, routeIndex, progress]);

  // Remove truck when no data
  useEffect(() => {
    if (data) return;
    truckRef.current?.remove();
    truckRef.current = null;
  }, [data]);

  const milesDone = selectedRoute
    ? ((progress * selectedRoute.distance_miles) || 0).toFixed(0)
    : "0";
  const milesTotal = selectedRoute ? selectedRoute.distance_miles.toFixed(0) : "0";

  return (
    <div className="route-map">
      <div ref={containerRef} className="route-map__canvas" />

      <div className="basemap-toggle" role="group" aria-label="Map style">
        <button
          type="button"
          className={basemap === "streets" ? "active" : ""}
          onClick={() => setBasemap("streets")}
        >
          Streets
        </button>
        <button
          type="button"
          className={basemap === "satellite" ? "active" : ""}
          onClick={() => setBasemap("satellite")}
        >
          Satellite
        </button>
      </div>

      {phase === "loading" && (
        <div className="route-map__overlay" aria-busy="true">
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

      {data && selectedRoute && (
        <div className="truck-scrubber">
          <div className="truck-scrubber__head">
            <strong>Drive path</strong>
            <span>
              {milesDone} / {milesTotal} mi
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(e) => setProgress(Number(e.target.value) / 1000)}
            aria-label="Move truck along selected route"
          />
          <div className="truck-scrubber__ends">
            <span>Start</span>
            <span>Destination</span>
          </div>
          {weatherAtTruck && (
            <div className="weather-chip">
              <span
                className="weather-chip__dot"
                style={{ background: RISK_COLORS[weatherAtTruck.risk as RiskLevel] }}
              />
              <div>
                <strong>
                  {RISK_LABELS[weatherAtTruck.risk]} · mi {weatherAtTruck.mile.toFixed(0)}
                </strong>
                <div>
                  Wind {weatherAtTruck.weather.wind_mph} mph · Rain{" "}
                  {weatherAtTruck.weather.rain_in_hr} in/hr · Snow{" "}
                  {weatherAtTruck.weather.snow_in_hr} in/hr
                  {weatherAtTruck.weather.temperature_f != null
                    ? ` · ${weatherAtTruck.weather.temperature_f}°F`
                    : ""}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {data && (
        <div className="route-color-legend">
          {data.routes.map((r, i) => (
            <span key={r.id} className={r.id === selectedId ? "active" : ""}>
              <i style={{ background: ROUTE_PALETTE[i % ROUTE_PALETTE.length] }} />
              {r.summary}
              {r.is_recommended ? " ★" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ensureExtraLayers(map: mapboxgl.Map) {
  if (!map.getSource("heatmap")) {
    map.addSource("heatmap", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "heatmap-layer",
      type: "heatmap",
      source: "heatmap",
      maxzoom: 14,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 1, 0.35, 5, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 8, 1.8],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 28, 8, 48],
        "heatmap-opacity": 0.72,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,229,255,0)",
          0.2,
          "rgba(42,157,143,0.55)",
          0.4,
          "rgba(255,200,0,0.65)",
          0.65,
          "rgba(255,140,0,0.8)",
          0.85,
          "rgba(231,111,81,0.9)",
          1,
          "rgba(155,34,38,0.95)",
        ],
      },
    });
    // Clear colored dots so forecast hour changes are obvious on satellite
    map.addLayer({
      id: "forecast-dots",
      type: "circle",
      source: "heatmap",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "score"], 1, 6, 5, 11],
        "circle-color": [
          "match",
          ["get", "risk"],
          "low",
          "#2a9d8f",
          "moderate",
          "#e9c46a",
          "high",
          "#f4a261",
          "severe",
          "#e76f51",
          "no_travel",
          "#9b2226",
          "#2a9d8f",
        ],
        "circle-opacity": 0.9,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  if (!map.getSource("traveled")) {
    map.addSource("traveled", {
      type: "geojson",
      data: lineFeature([]),
    });
    map.addLayer({
      id: "traveled-line",
      type: "line",
      source: "traveled",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        // Amber reads on both light streets and satellite
        "line-color": "#f59e0b",
        "line-width": 7,
        "line-opacity": 0.95,
        "line-blur": 0.15,
      },
    });
  }
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

    const color = ROUTE_PALETTE[i % ROUTE_PALETTE.length];
    const focused = route.id === selectedId || (!selectedId && route.is_recommended);
    const width = focused ? 8 : 5;
    const opacity = selectedId && route.id !== selectedId ? 0.4 : 0.95;

    map.addSource(id, { type: "geojson", data: lineFeature(coords) });

    map.addLayer({
      id: `${id}-casing`,
      type: "line",
      source: id,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#000000",
        "line-width": width + 5,
        "line-opacity": 0.65,
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
      },
    });

    // Keep above heatmap, below traveled
    try {
      if (map.getLayer("traveled-line")) {
        map.moveLayer(`${id}-casing`, "traveled-line");
        map.moveLayer(`${id}-line`, "traveled-line");
      } else if (map.getLayer("heatmap-layer")) {
        map.moveLayer(`${id}-casing`);
        map.moveLayer(`${id}-line`);
      }
    } catch {
      /* ignore */
    }

    const source = map.getSource(id) as mapboxgl.GeoJSONSource;
    const prog = { n: 2 };
    tweens.push(
      gsap.fromTo(
        prog,
        { n: 2 },
        {
          n: coords.length,
          duration: 1.4,
          delay: i * 0.12,
          ease: "power2.inOut",
          onUpdate: () => source.setData(lineFeature(coords.slice(0, Math.max(2, Math.round(prog.n))))),
          onComplete: () => source.setData(lineFeature(coords)),
        },
      ),
    );
  });

  return tweens;
}

function restyleRoutes(map: mapboxgl.Map, routes: RouteResult[], selectedId: string | null) {
  routes.forEach((route, i) => {
    const id = `route-${i}`;
    if (!map.getLayer(`${id}-line`)) return;
    const color = ROUTE_PALETTE[i % ROUTE_PALETTE.length];
    const focused = route.id === selectedId;
    const width = focused ? 8 : 5;
    const opacity = selectedId && route.id !== selectedId ? 0.4 : 0.95;
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
    for (const cp of route.checkpoints) {
      const el = document.createElement("div");
      el.className = focused ? "map-cp" : "map-cp map-cp--dim";
      el.style.setProperty("--cp-color", RISK_COLORS[cp.risk as RiskLevel]);
      const popup = new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
        `<div class="map-popup">
          <strong>${escapeHtml(route.summary)} · mi ${cp.mile.toFixed(0)}</strong>
          <span>Risk: ${RISK_LABELS[cp.risk]}</span>
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
      properties: {
        score: slot?.score ?? 1,
        risk: slot?.risk ?? "low",
      },
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
    };
  });
  (map.getSource("heatmap") as mapboxgl.GeoJSONSource | undefined)?.setData({
    type: "FeatureCollection",
    features,
  });
}

function fitToRoutes(map: mapboxgl.Map, routes: RouteResult[]) {
  const all = routes.flatMap((r) => normalizeCoords(r.geometry));
  if (all.length < 2) return;
  const bounds = all.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(all[0], all[0]),
  );
  map.resize();
  map.fitBounds(bounds, {
    padding: { top: 80, bottom: 160, left: 60, right: 60 },
    duration: 1100,
    maxZoom: 8.5,
    essential: true,
  });
}

function nearestCheckpoint(checkpoints: Checkpoint[], progress: number): Checkpoint | null {
  if (!checkpoints.length) return null;
  const maxMile = checkpoints[checkpoints.length - 1]?.mile || 1;
  const target = progress * maxMile;
  let best = checkpoints[0];
  let bestDist = Math.abs(best.mile - target);
  for (const cp of checkpoints) {
    const d = Math.abs(cp.mile - target);
    if (d < bestDist) {
      best = cp;
      bestDist = d;
    }
  }
  return best;
}

function normalizeCoords(geometry: number[][]): LngLat[] {
  return geometry
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(+c[0]) && Number.isFinite(+c[1]))
    .map((c) => [+c[0], +c[1]] as LngLat);
}

function lineFeature(coords: LngLat[]) {
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
