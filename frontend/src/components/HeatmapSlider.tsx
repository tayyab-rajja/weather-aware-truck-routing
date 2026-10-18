import type { RiskLevel } from "../types";
import { RISK_COLORS, RISK_LABELS } from "../lib/riskColors";

interface Props {
  hour: number;
  maxHours: number;
  label: string;
  /** Corridor summary for the selected forecast hour */
  summary?: {
    avgScore: number;
    dominantRisk: RiskLevel;
    sampleWind: number;
  } | null;
  onChange: (hour: number) => void;
}

export function HeatmapSlider({ hour, maxHours, label, summary, onChange }: Props) {
  return (
    <div className="heatmap-slider">
      <div className="heatmap-slider-head">
        <strong>48-hour forecast</strong>
        <span>
          +{hour}h · {label}
        </span>
      </div>
      <p className="heatmap-slider__hint">
        Scrub to preview how weather risk along the corridor changes over the next 2 days (map glow
        + dots update).
      </p>
      <input
        type="range"
        min={0}
        max={Math.max(0, maxHours - 1)}
        value={hour}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Forecast hour"
      />
      <div className="slider-ends">
        <span>Now</span>
        <span>+47h</span>
      </div>
      {summary && (
        <div className="forecast-chip">
          <span
            className="forecast-chip__dot"
            style={{ background: RISK_COLORS[summary.dominantRisk] }}
          />
          <div>
            <strong>
              Corridor at +{hour}h: {RISK_LABELS[summary.dominantRisk]}
            </strong>
            <div>
              Avg risk score {summary.avgScore.toFixed(2)} · sample wind{" "}
              {summary.sampleWind.toFixed(0)} mph
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
