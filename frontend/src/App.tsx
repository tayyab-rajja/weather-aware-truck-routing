import { useMemo, useState } from "react";
import { analyzeRoutes } from "./api/client";
import { HeatmapSlider } from "./components/HeatmapSlider";
import { RouteMap } from "./components/RouteMap";
import { RoutePanel } from "./components/RoutePanel";
import { TripForm } from "./components/TripForm";
import type { AnalyzeRequest, AnalyzeResponse } from "./types";
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

  return (
    <div className="app">
      <aside className="sidebar">
        <TripForm loading={loading} onSubmit={handleSubmit} />
        {error && <div className="error">{error}</div>}
        {loading && <p className="status-line">Sampling weather along alternate routes…</p>}
        {!data && !loading && !error && (
          <p className="status-line">Submit a trip to compare up to three weather-scored routes.</p>
        )}
        {data && (
          <RoutePanel data={data} selectedId={selectedId} onSelect={setSelectedId} />
        )}
        <div className="legend">
          <span>Risk</span>
          {(Object.keys(RISK_LABELS) as (keyof typeof RISK_LABELS)[]).map((k) => (
            <span key={k} className="legend-item">
              <i style={{ background: RISK_COLORS[k] }} />
              {RISK_LABELS[k]}
            </span>
          ))}
        </div>
      </aside>

      <main className="main">
        {/* Map always mounts so basemap is visible from the start */}
        <RouteMap data={data} selectedId={selectedId} forecastHour={forecastHour} />
        {data && (
          <HeatmapSlider
            hour={forecastHour}
            maxHours={data.heatmap.hours}
            label={hourLabel}
            onChange={setForecastHour}
          />
        )}
      </main>
    </div>
  );
}
