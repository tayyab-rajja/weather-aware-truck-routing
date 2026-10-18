import { useEffect, useRef, type MutableRefObject } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AnalyzeResponse, RiskLevel, RouteResult } from "../types";
import { RISK_COLORS, RISK_LABELS } from "../lib/riskColors";

/** Free Carto Voyager — roads, cities, readable, no API key */
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

const ROUTE_COLORS = ["#0f766e", "#2563eb", "#7c3aed"];
const RECOMMENDED = "#ea580c";

interface Props {
  data: AnalyzeResponse | null;
  selectedId: string | null;
  forecastHour: number;
}

export function RouteMap({ data, selectedId, forecastHour }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const readyRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const clickBoundRef = useRef(false);
  const lastDataIdRef = useRef<string | null>(null);

  // Create map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-87.6, 41.8],
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      maxWidth: "280px",
      className: "route-popup",
    });

    const onReady = () => {
      readyRef.current = true;
      map.resize();
    };
    map.on("load", onReady);

    const onResize = () => map.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Paint routes / checkpoints when analysis or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const run = () => {
      map.resize();
      ensureLayers(map, clickBoundRef, popupRef.current);

      const dataKey = `${data.recommended_route_id}-${data.routes.map((r) => r.id).join(",")}-${data.sample_interval_miles}`;
      const isNewTrip = lastDataIdRef.current !== dataKey;
      lastDataIdRef.current = dataKey;

      updateHeatmap(map, data, forecastHour);
      updateCheckpoints(map, data, selectedId);

      if (isNewTrip) {
        fitToRoutes(map, data.routes);
        animateRoutesDraw(map, data.routes, selectedId, animRef);
      } else {
        setRoutesFull(map, data.routes, selectedId);
      }
    };

    if (readyRef.current || map.isStyleLoaded()) {
      run();
    } else {
      map.once("load", () => {
        readyRef.current = true;
        run();
      });
    }
    // forecastHour handled separately for speed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedId]);

  // Fast heatmap-only update while scrubbing
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !map.getSource("heatmap")) return;
    updateHeatmap(map, data, forecastHour);
  }, [data, forecastHour]);

  return <div className="map-root" ref={containerRef} />;
}

function ensureLayers(
  map: Map,
  clickBoundRef: MutableRefObject<boolean>,
  popup: Popup | null,
) {
  if (!map.getSource("heatmap")) {
    map.addSource("heatmap", emptyFc());
    map.addLayer({
      id: "heatmap-layer",
      type: "heatmap",
      source: "heatmap",
      maxzoom: 11,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 1, 0.15, 5, 1],
        "heatmap-intensity": 0.9,
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 18, 8, 32],
        "heatmap-opacity": 0.45,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(42,157,143,0)",
          0.25,
          "rgba(42,157,143,0.35)",
          0.45,
          "rgba(233,196,106,0.55)",
          0.65,
          "rgba(244,162,97,0.65)",
          0.85,
          "rgba(231,111,81,0.75)",
          1,
          "rgba(155,34,38,0.85)",
        ],
      },
    });
  }

  if (!map.getSource("routes")) {
    map.addSource("routes", emptyFc());
    // Soft casing under the route for contrast on pale terrain
    map.addLayer({
      id: "routes-casing",
      type: "line",
      source: "routes",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["+", ["get", "width"], 4],
        "line-opacity": 0.9,
      },
    });
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

  if (!map.getSource("checkpoints")) {
    map.addSource("checkpoints", emptyFc());
    map.addLayer({
      id: "checkpoints-circle",
      type: "circle",
      source: "checkpoints",
      paint: {
        "circle-radius": ["get", "radius"],
        "circle-color": ["get", "color"],
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-width": ["get", "stroke"],
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  if (!clickBoundRef.current) {
    clickBoundRef.current = true;
    map.on("click", "checkpoints-circle", (e) => {
      const f = e.features?.[0];
      if (!f || !popup) return;
      const p = f.properties!;
      const coords = (f.geometry as { coordinates: [number, number] }).coordinates;
      popup
        .setLngLat(coords)
        .setHTML(
          `<div class="popup-card">
            <strong>${escapeHtml(String(p.routeSummary))} · mi ${Number(p.mile).toFixed(0)}</strong>
            <div>Risk: ${RISK_LABELS[p.risk as RiskLevel] || p.risk}</div>
            <div>ETA: ${new Date(String(p.eta)).toLocaleString()}</div>
            <div>Wind ${p.wind} mph · Rain ${p.rain} · Snow ${p.snow}</div>
            <em>${escapeHtml(String(p.reasons || ""))}</em>
          </div>`,
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

function routeFeatures(routes: RouteResult[], selectedId: string | null, progress = 1) {
  return routes.map((r, i) => {
    const focused = r.id === selectedId || r.is_recommended;
    const coords = sliceLine(r.geometry, progress);
    return {
      type: "Feature" as const,
      properties: {
        id: r.id,
        color: r.is_recommended ? RECOMMENDED : ROUTE_COLORS[i % ROUTE_COLORS.length],
        width: focused ? 5.5 : 3.25,
        opacity: selectedId && r.id !== selectedId ? 0.4 : 0.95,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: coords.length >= 2 ? coords : r.geometry.slice(0, 2),
      },
    };
  });
}

function setRoutesFull(map: Map, routes: RouteResult[], selectedId: string | null) {
  const src = map.getSource("routes") as GeoJSONSource | undefined;
  if (!src) return;
  src.setData({
    type: "FeatureCollection",
    features: routeFeatures(routes, selectedId, 1),
  });
}

function animateRoutesDraw(
  map: Map,
  routes: RouteResult[],
  selectedId: string | null,
  animRef: MutableRefObject<number | null>,
) {
  if (animRef.current) cancelAnimationFrame(animRef.current);
  const src = map.getSource("routes") as GeoJSONSource | undefined;
  if (!src) return;

  const duration = 900;
  const start = performance.now();

  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    // ease-out cubic — soothing
    const eased = 1 - (1 - t) ** 3;
    src.setData({
      type: "FeatureCollection",
      features: routeFeatures(routes, selectedId, eased),
    });
    if (t < 1) {
      animRef.current = requestAnimationFrame(tick);
    } else {
      animRef.current = null;
    }
  };

  // Start nearly empty so the draw-on is visible
  src.setData({
    type: "FeatureCollection",
    features: routeFeatures(routes, selectedId, 0.02),
  });
  animRef.current = requestAnimationFrame(tick);
}

function updateCheckpoints(map: Map, data: AnalyzeResponse, selectedId: string | null) {
  const focusId = selectedId || data.recommended_route_id || data.routes[0]?.id;
  const features = data.routes.flatMap((route) => {
    const focused = route.id === focusId;
    return route.checkpoints.map((c) => ({
      type: "Feature" as const,
      properties: {
        routeSummary: route.summary,
        mile: c.mile,
        risk: c.risk,
        color: RISK_COLORS[c.risk as RiskLevel],
        eta: c.eta,
        wind: c.weather.wind_mph,
        rain: c.weather.rain_in_hr,
        snow: c.weather.snow_in_hr,
        reasons: (c.risk_reasons || []).join("; "),
        radius: focused ? 7 : 4.5,
        opacity: focused ? 1 : 0.5,
        stroke: focused ? 2.5 : 1.25,
      },
      geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] },
    }));
  });

  const src = map.getSource("checkpoints") as GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features });
}

function updateHeatmap(map: Map, data: AnalyzeResponse, hour: number) {
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
    map.fitBounds(bounds, { padding: 64, maxZoom: 7.5, duration: 850, essential: true });
  }
}

/** Progressively reveal a polyline (0..1). */
function sliceLine(coords: [number, number][] | number[][], progress: number): number[][] {
  if (!coords.length) return [];
  if (progress >= 0.999) return coords as number[][];
  if (progress <= 0) return [coords[0] as number[]];

  const total = coords.length - 1;
  const target = progress * total;
  const i = Math.floor(target);
  const frac = target - i;
  const out = coords.slice(0, i + 1).map((c) => [c[0], c[1]]);
  if (i + 1 < coords.length) {
    const a = coords[i];
    const b = coords[i + 1];
    out.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
  }
  return out;
}

function emptyFc() {
  return {
    type: "geojson" as const,
    data: { type: "FeatureCollection" as const, features: [] as never[] },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
