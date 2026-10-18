# Weather-Aware Truck Routing

React + Django app that helps a truck driver choose the **safest route** based on **weather**, **load weight**, and **travel time**.

> **Live app:** _add Vercel URL after deploy_  
> **API:** _add Render URL after deploy_

## What it does

1. Geocodes origin & destination (Mapbox)
2. Fetches up to **3 driving routes** (Mapbox Directions `alternatives=true`)
3. Samples weather every **10 / 25 / 50 miles** at the truck’s ETA (Open-Meteo)
4. Scores each checkpoint with the assessment **risk + load rules**
5. Recommends a route: fewest Severe miles → fewest High → lowest avg risk → shortest time
6. Shows routes, checkpoints, and a **48-hour forecast heatmap slider** on the map

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Vite, React, TypeScript, MapLibre GL |
| Backend | Django 4, DRF |
| Routing / geocode | Mapbox |
| Weather | Open-Meteo (no API key) |

## Quick start

### 1. Mapbox token

Create a token at [account.mapbox.com](https://account.mapbox.com/access-tokens/).

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set MAPBOX_TOKEN
python manage.py migrate
python manage.py runserver
```

API: `http://localhost:8000` · health: `/healthz/`

```bash
pytest   # 24 unit tests for risk, recommend, sampling
```

### 3. Frontend

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

Optional: `origin_coords` / `destination_coords` as `[lng, lat]` from autocomplete.

**Response (shape):**

- `routes[]` — `id`, `summary`, `distance_miles`, `duration_minutes`, `geometry`, `checkpoints[]`, `metrics`, `is_recommended`, `recommendation_reason`
- `checkpoints[]` — `mile`, `eta`, `lng`, `lat`, `weather`, `risk`, `risk_reasons`
- `recommended_route_id`
- `heatmap` — corridor points with `hours[0..47]` risk scores for the slider

### `GET /api/geocode/?q=`

Autocomplete suggestions for the form.

## Risk rules

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

Segment miles between checkpoints are attributed to the **arrival** checkpoint’s risk. `no_travel` miles count toward severe miles for recommendation ranking.

## Deploy

**Backend (Render):** connect this repo, root `backend`, use `render.yaml` / `Procfile`. Set `MAPBOX_TOKEN`, `CORS_ALLOWED_ORIGINS` (your Vercel URL), `ALLOWED_HOSTS`.

**Frontend (Vercel):** root `frontend`, set `VITE_API_URL` to the Render API origin (no trailing path). Redeploy after changing env vars.

## Loom

See [LOOM.md](LOOM.md) for a 5–10 minute walkthrough script.

## Project layout

```
backend/routing/services/   # mapbox, sampling, weather, risk, metrics, recommend, planner
frontend/src/components/    # form, map, route panel, heatmap slider
plan                        # build plan
fs-assessment-spotter.md    # original brief
```
