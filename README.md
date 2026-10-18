# Weather-Aware Truck Routing

React + Django app that helps a truck driver choose the **safest route** based on **weather**, **load weight**, and **travel time**.

> **GitHub:** https://github.com/SheharyarAhmad1991/weather-aware-truck-routing  
> **Live app:** https://frontend-kappa-nine-95.vercel.app  
> **API:** https://backend-flame-ten-24.vercel.app  

**100% free stack** — no paid APIs or paid map tokens required.

## What it does

1. Geocodes origin & destination (**Nominatim** / OpenStreetMap)
2. Builds **3 driving route options** (**OSRM** — alternatives + via-point corridors when needed)
3. Samples weather every **10 / 25 / 50 miles** at the truck’s ETA (**Open-Meteo**)
4. Scores each checkpoint with the assessment **risk + load rules**
5. Recommends a route: fewest Severe miles → fewest High → lowest avg risk → shortest time
6. Shows all routes, checkpoints (risk + ETA), summaries, and a **48-hour forecast heatmap slider**

## Stack (all free)

| Layer | Tech | Cost |
| --- | --- | --- |
| Frontend | Vite, React, TypeScript, MapLibre GL | Free |
| Basemap | OpenFreeMap | Free, no token |
| Backend | Django 4 + DRF | Free |
| Geocode | Nominatim | Free, no key |
| Routing | OSRM public API | Free, no key |
| Weather | Open-Meteo | Free, no key |
| Host | Vercel Hobby | Free tier |

## Quick start

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

API: `http://localhost:8000` · health: `/healthz/`

```bash
pytest
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8000
npm run dev
```

App: `http://localhost:5173`

## API

### `POST /api/analyze/`

```json
{
  "origin": "Chicago, IL",
  "destination": "Detroit, MI",
  "departure_at": "2026-10-18T14:00:00Z",
  "load_weight_lb": 35000,
  "sample_interval_miles": 25
}
```

**Response:** `routes[]` (geometry, checkpoints with weather/risk/ETA, metrics), `recommended_route_id`, `heatmap` (48 hourly scores along the corridor).

### `GET /api/geocode/?q=`

Free Nominatim autocomplete for the form.

## Risk rules (from assessment)

Worst of wind / rain / snow, then load overrides:

| Level | Wind (mph) | Rain (in/hr) | Snow (in/hr) |
| --- | --- | --- | --- |
| Low | &lt;25 | &lt;0.10 | &lt;0.5 |
| Moderate | 25–34 | 0.10–0.25 | 0.5–1.0 |
| High | 35–44 | 0.25–0.50 | 1.0–2.0 |
| Severe | 45–54 | 0.50–1.00 | 2.0–3.0 |
| No Travel | ≥55 | &gt;1.00 | &gt;3.0 |

**Load overrides**

- Wind ≥55 mph → No Travel (any load)
- Wind 45–54 mph + load &gt;30,000 lb → No Travel
- Wind 35–44 mph + load &gt;40,000 lb → Severe

**Recommendation order:** fewest Severe miles → fewest High miles → lowest average risk → shortest travel time.

Segment miles between checkpoints are attributed to the **arrival** checkpoint’s risk. `no_travel` miles count toward severe miles for ranking.

## Loom

See [LOOM.md](LOOM.md) for a 5–10 minute walkthrough script.

## Project layout

```
backend/routing/services/   # geo, sampling, weather, risk, metrics, recommend, planner
frontend/src/components/    # form, map, route panel, heatmap slider
plan                        # build plan
fs-assessment-spotter.md    # original brief
```
