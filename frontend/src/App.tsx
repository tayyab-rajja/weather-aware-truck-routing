import { useMemo, useState } from "react";
import { analyzeRoutes } from "./api/client";
import { HeatmapSlider } from "./components/HeatmapSlider";
import { RouteMap } from "./components/RouteMap";
import { RoutePanel } from "./components/RoutePanel";
import { TripForm } from "./components/TripForm";
import type { AnalyzeRequest, AnalyzeResponse, RiskLevel } from "./types";
import { RISK_COLORS, RISK_LABELS } from "./lib/riskColors";
import "./App.css";

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [forecastHour, setForecastHour] = useState(0);

  async function handleSubmit(body: AnalyzeRequest) {
    setLoading(true);
    setError(null);
    try {
      const result = await analyzeRoutes(body);
      setData(result);
      setSelectedId(result.recommended_route_id || result.routes[0]?.id || null);
      setForecastHour(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const hourLabel = useMemo(() => {
    if (!data?.heatmap.points[0]?.hours[forecastHour]) return "—";
    const t = data.heatmap.points[0].hours[forecastHour].time;
    return new Date(t + "Z").toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
    });
  }, [data, forecastHour]);

  const forecastSummary = useMemo(() => {
    if (!data?.heatmap.points.length) return null;
    const slots = data.heatmap.points.map(
      (p) => p.hours.find((h) => h.hour_offset === forecastHour) || p.hours[0],
    );
    if (!slots.length) return null;

    const avgScore = slots.reduce((s, h) => s + (h?.score ?? 1), 0) / slots.length;
    const counts: Record<string, number> = {};
    for (const h of slots) {
      const r = h?.risk || "low";
      counts[r] = (counts[r] || 0) + 1;
    }
    const dominantRisk = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "low") as RiskLevel;

    const winds = slots
      .map((h) => h?.wind_mph)
      .filter((w): w is number => typeof w === "number");
    const sampleWind =
      winds.length > 0 ? winds.reduce((a, b) => a + b, 0) / winds.length : null;

    return { avgScore, dominantRisk, sampleWind };
  }, [data, forecastHour]);

  return (
    <div className="app">
      <aside className="sidebar">
        <TripForm loading={loading} onSubmit={handleSubmit} />
        {error && <div className="error">{error}</div>}
        {loading && (
          <p className="status-line">Routing + weather scoring in progress…</p>
        )}
        {!data && !loading && !error && (
          <p className="status-line">Enter a trip above to score up to three corridors.</p>
        )}
        {data && (
          <RoutePanel data={data} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        <div className="legend">
          <span>Risk key</span>
          {(Object.keys(RISK_LABELS) as (keyof typeof RISK_LABELS)[]).map((k) => (
            <span key={k} className="legend-item">
              <i style={{ background: RISK_COLORS[k] }} />
              {RISK_LABELS[k]}
            </span>
          ))}
        </div>
      </aside>

      <main className="main">
        <RouteMap data={data} selectedId={selectedId} forecastHour={forecastHour} />
        {data && (
          <HeatmapSlider
            hour={forecastHour}
            maxHours={data.heatmap.hours}
            label={hourLabel}
            summary={forecastSummary}
            onChange={setForecastHour}
          />
        )}
      </main>
    </div>
  );
}
