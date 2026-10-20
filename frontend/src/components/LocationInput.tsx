import { useEffect, useRef, useState } from "react";
import { suggestPlaces } from "../api/client";
import type { PlaceSuggestion } from "../types";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (label: string, coords?: [number, number]) => void;
}

export function LocationInput({ id, label, value, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  function handleType(next: string) {
    onChange(next, undefined);
    setHint(null);
    if (timer.current) window.clearTimeout(timer.current);

    if (!next.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const idNow = ++reqId.current;
    timer.current = window.setTimeout(async () => {
      try {
        const results = await suggestPlaces(next);
        if (idNow !== reqId.current) return;
        setSuggestions(results);
        setOpen(results.length > 0);
        setHint(results.length === 0 ? "No matching places" : null);
      } catch {
        if (idNow !== reqId.current) return;
        setSuggestions([]);
        setOpen(false);
        setHint("Place search unavailable");
      }
    }, 280);
  }

  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        value={value}
        autoComplete="off"
        placeholder="City or place"
        onChange={(e) => handleType(e.target.value)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className="suggest" role="listbox">
          {suggestions.map((s) => (
            <li key={`${s.label}-${s.lng}-${s.lat}`}>
              <button
                type="button"
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.label, [s.lng, s.lat]);
                  setOpen(false);
                  setSuggestions([]);
                  setHint(null);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint && !open && <p className="field-hint">{hint}</p>}
    </label>
  );
}
