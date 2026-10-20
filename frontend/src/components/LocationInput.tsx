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
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  function handleType(next: string) {
    onChange(next, undefined);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const results = await suggestPlaces(next);
      setSuggestions(results);
      setOpen(results.length > 0);
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
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onFocus={() => suggestions.length && setOpen(true)}
      />
      {open && (
        <ul className="suggest">
          {suggestions.map((s) => (
            <li key={`${s.label}-${s.lng}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.label, [s.lng, s.lat]);
                  setOpen(false);
                  setSuggestions([]);
                }}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
