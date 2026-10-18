interface Props {
  hour: number;
  maxHours: number;
  label: string;
  onChange: (hour: number) => void;
}

export function HeatmapSlider({ hour, maxHours, label, onChange }: Props) {
  return (
    <div className="heatmap-slider">
      <div className="heatmap-slider-head">
        <strong>48-hour forecast</strong>
        <span>
          +{hour}h · {label}
        </span>
      </div>
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
    </div>
  );
}
