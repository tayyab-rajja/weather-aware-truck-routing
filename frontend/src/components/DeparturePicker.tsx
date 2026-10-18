import { useEffect, useMemo, useRef, useState } from "react";
import "./DeparturePicker.css";

interface Props {
  value: string; // `YYYY-MM-DDTHH:mm`
  onChange: (value: string) => void;
}

type ClockMode = "hour" | "minute";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseValue(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return now;
  }
  return d;
}

function toValue(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplay(d: Date) {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DeparturePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const draft = useMemo(() => parseValue(value), [value]);
  const [view, setView] = useState(() => new Date(draft.getFullYear(), draft.getMonth(), 1));
  const [selDate, setSelDate] = useState(() => new Date(draft));
  const [hour24, setHour24] = useState(draft.getHours());
  const [minute, setMinute] = useState(draft.getMinutes());
  const [mode, setMode] = useState<ClockMode>("hour");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = parseValue(value);
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelDate(new Date(d));
    setHour24(d.getHours());
    setMinute(d.getMinutes());
    setMode("hour");
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hour12 = ((hour24 + 11) % 12) + 1;
  const isPm = hour24 >= 12;

  function confirm() {
    const next = new Date(selDate);
    next.setHours(hour24, minute, 0, 0);
    onChange(toValue(next));
    setOpen(false);
  }

  function setAmPm(pm: boolean) {
    const h12 = hour24 % 12;
    setHour24(pm ? h12 + 12 : h12);
  }

  const monthLabel = view.toLocaleString(undefined, { month: "long", year: "numeric" });
  const cells = buildCalendar(view.getFullYear(), view.getMonth());

  return (
    <div className="dep-picker field" ref={rootRef}>
      <span>Departure</span>
      <button
        type="button"
        className="dep-picker__trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{formatDisplay(parseValue(value))}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="dep-picker__pop" role="dialog" aria-label="Pick departure date and time">
          <div className="dep-picker__body">
            <div className="dep-cal">
              <div className="dep-cal__nav">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                >
                  ‹
                </button>
                <strong>{monthLabel}</strong>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                >
                  ›
                </button>
              </div>
              <div className="dep-cal__dow">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="dep-cal__grid">
                {cells.map((cell, i) => {
                  if (!cell) return <span key={`e-${i}`} className="dep-cal__empty" />;
                  const selected =
                    cell.getFullYear() === selDate.getFullYear() &&
                    cell.getMonth() === selDate.getMonth() &&
                    cell.getDate() === selDate.getDate();
                  const today = isSameDay(cell, new Date());
                  return (
                    <button
                      key={cell.toISOString()}
                      type="button"
                      className={`dep-cal__day ${selected ? "is-selected" : ""} ${today ? "is-today" : ""}`}
                      onClick={() => setSelDate(new Date(cell))}
                    >
                      {cell.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="dep-clock-wrap">
              <div className="dep-clock__readout">
                <button
                  type="button"
                  className={mode === "hour" ? "is-active" : ""}
                  onClick={() => setMode("hour")}
                >
                  {pad(hour12)}
                </button>
                <span>:</span>
                <button
                  type="button"
                  className={mode === "minute" ? "is-active" : ""}
                  onClick={() => setMode("minute")}
                >
                  {pad(minute)}
                </button>
                <div className="dep-ampm">
                  <button type="button" className={!isPm ? "is-active" : ""} onClick={() => setAmPm(false)}>
                    AM
                  </button>
                  <button type="button" className={isPm ? "is-active" : ""} onClick={() => setAmPm(true)}>
                    PM
                  </button>
                </div>
              </div>

              <AnalogClock
                mode={mode}
                hour12={hour12}
                minute={minute}
                onPickHour={(h12) => {
                  const base = isPm ? 12 : 0;
                  const h = h12 === 12 ? base : base + h12;
                  setHour24(h === 24 ? 12 : h);
                  setMode("minute");
                }}
                onPickMinute={(m) => setMinute(m)}
              />
            </div>
          </div>

          <div className="dep-picker__actions">
            <button type="button" className="dep-btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="dep-btn primary" onClick={confirm}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalogClock({
  mode,
  hour12,
  minute,
  onPickHour,
  onPickMinute,
}: {
  mode: ClockMode;
  hour12: number;
  minute: number;
  onPickHour: (h: number) => void;
  onPickMinute: (m: number) => void;
}) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const r = 78;

  const activeAngle =
    mode === "hour" ? ((hour12 % 12) / 12) * 360 : (minute / 60) * 360;
  const handLen = mode === "hour" ? 48 : 62;

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;

    if (mode === "hour") {
      let h = Math.round(deg / 30) % 12;
      if (h === 0) h = 12;
      onPickHour(h);
    } else {
      const m = Math.round(deg / 6) % 60;
      onPickMinute(m);
    }
  }

  const numbers =
    mode === "hour"
      ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  return (
    <svg
      className="dep-clock"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={onPointer}
      role="img"
      aria-label={mode === "hour" ? "Select hour" : "Select minute"}
    >
      <circle cx={cx} cy={cy} r={88} className="dep-clock__face" />
      {numbers.map((n, i) => {
        const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        const selected = mode === "hour" ? n === hour12 : n === minute;
        return (
          <g key={`${mode}-${n}`}>
            <circle
              cx={x}
              cy={y}
              r={selected ? 16 : 14}
              className={`dep-clock__num-bg ${selected ? "is-selected" : ""}`}
            />
            <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" className="dep-clock__num">
              {mode === "hour" ? n : pad(n)}
            </text>
          </g>
        );
      })}
      <line
        x1={cx}
        y1={cy}
        x2={cx + Math.sin((activeAngle * Math.PI) / 180) * handLen}
        y2={cy - Math.cos((activeAngle * Math.PI) / 180) * handLen}
        className="dep-clock__hand"
      />
      <circle cx={cx} cy={cy} r={5} className="dep-clock__hub" />
    </svg>
  );
}

function buildCalendar(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const start = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < start; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
