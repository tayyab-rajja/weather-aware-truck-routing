import type { AnalyzeResponse, RouteResult } from "../types";
import { RISK_LABELS } from "../lib/riskColors";
import { ROUTE_PALETTE } from "./RouteMap";

interface Props {
  data: AnalyzeResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function RoutePanel({ data, selectedId, onSelect }: Props) {
  return (
    <div className="route-panel">
      <h2>Corridor options</h2>
      <ul>
        {data.routes.map((r, i) => (
          <RouteCard
            key={r.id}
            route={r}
            color={ROUTE_PALETTE[i % ROUTE_PALETTE.length]}
            active={r.id === selectedId}
            onSelect={() => onSelect(r.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function RouteCard({
  route,
  color,
  active,
  onSelect,
}: {
  route: RouteResult;
  color: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`route-card ${active ? "active" : ""} ${route.is_recommended ? "recommended" : ""}`}
        onClick={onSelect}
        style={{ borderLeftColor: color, borderLeftWidth: 4 }}
      >
        <div className="route-card-head">
          <strong>
            <i className="route-swatch" style={{ background: color }} />
            {route.summary || route.id}
          </strong>
          {route.is_recommended && <span className="badge">Best pick</span>}
        </div>
        <div className="route-stats">
          <span>{route.distance_miles.toFixed(0)} mi</span>
          <span>{fmtDuration(route.duration_minutes)}</span>
          <span>Severe {route.metrics.severe_miles.toFixed(0)} mi</span>
          <span>High {route.metrics.high_miles.toFixed(0)} mi</span>
          {route.metrics.no_travel_miles > 0 && (
            <span>No travel {route.metrics.no_travel_miles.toFixed(0)} mi</span>
          )}
          <span>Avg risk {route.metrics.avg_risk.toFixed(2)}</span>
        </div>
        {route.is_recommended && route.recommendation_reason && (
          <p className="why">{route.recommendation_reason}</p>
        )}
        {route.checkpoints[0] && (
          <p className="hint">
            First checkpoint risk: {RISK_LABELS[route.checkpoints[0].risk]}
          </p>
        )}
      </button>
    </li>
  );
}
