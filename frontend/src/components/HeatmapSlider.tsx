import type { RiskLevel } from "../types";
import { RISK_COLORS, RISK_LABELS } from "../lib/riskColors";

interface Props {
  hour: number;
  maxHours: number;
  label: string;
  summary?: {
    avgScore: number;
    dominantRisk: RiskLevel;
    sampleWind: number | null;
  } | null;
  onChange: (hour: number) => void;
}

export function HeatmapSlider({ hour, maxHours, label, summary, onChange }: Props) {
  const endHour = Math.max(0, maxHours - 1);

  return (
    <div className="heatmap-slider">
      <div className="heatmap-slider-head">
        <strong>48-hour forecast</strong>
        <span>
          +{hour}h · {label}
        </span>
      </div>
      <p className="heatmap-slider__hint">
        Scrub to preview corridor weather risk — map glow and dots update each hour.
      </p>
      <input
        type="range"
        min={0}
        max={endHour}
        value={hour}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Forecast hour"
      />
      <div className="slider-ends">
        <span>Now</span>
        <span>+{endHour}h</span>
      </div>
      {summary && (
        <div className="forecast-chip">
          <span
            className="forecast-chip__dot"
            style={{ background: RISK_COLORS[summary.dominantRisk] }}
          />
          <div>
            <strong>
              Corridor risk at +{hour}h: {RISK_LABELS[summary.dominantRisk]}
            </strong>
            <div>
              Avg score {summary.avgScore.toFixed(2)}
              {summary.sampleWind != null
                ? ` · corridor wind ${summary.sampleWind.toFixed(0)} mph`
                : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
