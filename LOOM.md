# Loom walkthrough script (5–10 min)

Record this exact flow — nothing extra.

**Demo trip (pre-filled in the form):**
- Origin: Chicago, IL → Destination: Detroit, MI
- Load: **42,000 lb** (triggers load override: wind 35–44 mph → Severe)
- Sample every **25 mi**

1. **Intro (30s)** — “Weather-Aware Truck Routing: React + Django app that picks the safest truck route using weather, load weight, and travel time.”
2. **Form (1 min)** — Show the demo fields (origin, destination, departure, 42,000 lb, 25 mi). Submit.
3. **Three routes (2 min)** — Show map with all routes; click each route card; call out distance, time, severe/high miles, avg risk. Toggle Streets / Satellite if useful.
4. **Recommended route (1–2 min)** — Explain the preference order: fewest Severe → fewest High → lowest avg risk → shortest time. Read the “why recommended” line.
5. **Checkpoint risk (2 min)** — Click a checkpoint marker; show **ETA**, wind/rain/snow, risk level, and **risk reasons** (call out a load override if present, e.g. “wind 35–44 + load >40,000 lb → severe”).
6. **48h heatmap slider (1–2 min)** — Scrub the forecast slider; point at the **“Corridor risk at +Nh”** label and show glow/dots changing along the corridor.
7. **Close (30s)** — Point to GitHub README for setup, risk table, and hosted URL.
