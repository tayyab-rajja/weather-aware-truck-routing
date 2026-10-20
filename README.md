# Weather-Aware Truck Routing

A React + Django tool for drivers who need the **safest practical corridor** when weather, cargo weight, and schedule all matter.

> **Repository:** https://github.com/tayyab-rajja/weather-aware-truck-routing  
> **Web app:** https://frontend-kappa-nine-95.vercel.app  
> **Backend API:** https://backend-flame-ten-24.vercel.app  

Runs on a free stack (no paid map or weather keys required).

## Capabilities

1. Resolve start and end points (**Nominatim** / OpenStreetMap)
2. Request up to **three** driving corridors (**OSRM**, with via-point fallbacks when needed)
3. Pull weather every **10 / 25 / 50 miles** at each checkpoint ETA (**Open-Meteo**)
4. Apply the brief’s **weather risk bands** and **load overrides**
5. Rank corridors: fewest Severe miles → fewest High → lowest average risk → shortest time
6. Render corridors, checkpoints (risk + ETA), summaries, and a **48-hour corridor forecast** slider on the map

## Technology

| Piece | Choice | Notes |
| --- | --- | --- |
| UI | Vite, React, TypeScript, Mapbox GL JS | Free |
| Map tiles | Esri street + satellite rasters | No token |
| API | Django 4 + DRF | Free |
| Places | Nominatim | No key |
| Directions | Public OSRM | No key |
| Forecast | Open-Meteo | No key |
| Hosting | Vercel Hobby | Free tier |

## Local setup

### API server

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

Base URL: `http://localhost:8000` · health check: `/healthz/`

```bash
pytest
```

### Web client

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8000
npm run dev
```

Open `http://localhost:5173`

## HTTP API

### `POST /api/analyze/`

```json
{
  "origin": "Chicago, IL",
  "destination": "Detroit, MI",
  "departure_at": "2026-10-18T14:00:00Z",
  "load_weight_lb": 42000,
  "sample_interval_miles": 25
}
```

Returns scored `routes[]` (geometry, checkpoints with weather/risk/ETA, metrics), `recommended_route_id`, and a 48-hour `heatmap` along the chosen corridor.

### `GET /api/geocode/?q=`

Nominatim-backed place suggestions for the trip form.

## Risk model (assessment brief)

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

**Ranking:** fewest Severe miles → fewest High miles → lowest average risk → shortest travel time.

Miles between checkpoints are charged to the **arrival** checkpoint’s risk. `no_travel` miles also count toward severe miles when ranking.

## Walkthrough

See [LOOM.md](LOOM.md) for a 5–10 minute recording outline.

## Layout

```
backend/routing/services/   # geo, sampling, weather, risk, metrics, recommend, planner
frontend/src/components/    # trip form, map, corridor list, forecast slider
plan                        # implementation notes
fs-assessment-spotter.md    # assignment brief
```
