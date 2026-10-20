import { useEffect, useRef, useState } from "react";
import { suggestPlaces } from "../api/client";
import type { PlaceSuggestion } from "../types";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (label: string, coords?: [number, number]) => void;
}

const CACHE = new Map<string, PlaceSuggestion[]>();
const DEBOUNCE_MS = 120;

export function LocationInput({ id, label, value, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      abortRef.current?.abort();
    };
  }, []);

  function applyResults(results: PlaceSuggestion[]) {
    setSuggestions(results);
    setOpen(results.length > 0);
    setHint(results.length === 0 ? "No matching places" : null);
  }

  function handleType(next: string) {
    onChange(next, undefined);
    setHint(null);
    if (timer.current) window.clearTimeout(timer.current);
    abortRef.current?.abort();

    const key = next.trim().toLowerCase();
    if (key.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const cached = CACHE.get(key);
    if (cached) {
      applyResults(cached);
      return;
    }

    const idNow = ++reqId.current;
    timer.current = window.setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const results = await suggestPlaces(next, ctrl.signal);
        if (idNow !== reqId.current || ctrl.signal.aborted) return;
        CACHE.set(key, results);
        if (CACHE.size > 80) {
          const first = CACHE.keys().next().value;
          if (first) CACHE.delete(first);
        }
        applyResults(results);
      } catch (err) {
        if (ctrl.signal.aborted || idNow !== reqId.current) return;
        setSuggestions([]);
        setOpen(false);
        setHint("Place search unavailable");
        void err;
      }
    }, DEBOUNCE_MS);
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
