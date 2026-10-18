import { useState, type FormEvent } from "react";
import type { AnalyzeRequest } from "../types";
import { DeparturePicker } from "./DeparturePicker";
import { LocationInput } from "./LocationInput";

interface Props {
  loading: boolean;
  onSubmit: (body: AnalyzeRequest) => void;
}

function defaultDeparture(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState("Chicago, IL");
  const [destination, setDestination] = useState("Detroit, MI");
  const [originCoords, setOriginCoords] = useState<[number, number] | undefined>();
  const [destCoords, setDestCoords] = useState<[number, number] | undefined>();
  const [departure, setDeparture] = useState(defaultDeparture);
  const [weight, setWeight] = useState(35000);
  const [interval, setInterval] = useState<10 | 25 | 50>(25);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      origin,
      destination,
      departure_at: new Date(departure).toISOString(),
      load_weight_lb: weight,
      sample_interval_miles: interval,
      origin_coords: originCoords,
      destination_coords: destCoords,
    });
  }

  return (
    <form className="trip-form" onSubmit={handleSubmit}>
      <h1>Weather-Aware Truck Routing</h1>
      <p className="lede">
        Compare up to three routes by weather risk, load weight, and travel time.
      </p>

      <LocationInput
        id="origin"
        label="Origin"
        value={origin}
        onChange={(label, coords) => {
          setOrigin(label);
          setOriginCoords(coords);
        }}
      />
      <LocationInput
        id="destination"
        label="Destination"
        value={destination}
        onChange={(label, coords) => {
          setDestination(label);
          setDestCoords(coords);
        }}
      />

      <DeparturePicker value={departure} onChange={setDeparture} />

      <label className="field" htmlFor="weight">
        <span>Load weight (lb)</span>
        <input
          id="weight"
          type="number"
          min={0}
          step={100}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          required
        />
      </label>

      <fieldset className="interval">
        <legend>Sample weather every</legend>
        {([10, 25, 50] as const).map((n) => (
          <label key={n}>
            <input
              type="radio"
              name="interval"
              checked={interval === n}
              onChange={() => setInterval(n)}
            />
            {n} mi
          </label>
        ))}
      </fieldset>

      <button type="submit" className="primary" disabled={loading}>
        {loading ? "Analyzing routes…" : "Find safest routes"}
      </button>
    </form>
  );
}
