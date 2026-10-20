# Loom walkthrough outline (5–10 min)

Keep the recording tight — cover the brief, nothing extra.

**Sample trip (form defaults):**
- Start: Chicago, IL → End: Detroit, MI
- Cargo: **42,000 lb** (load override when wind is 35–44 mph → Severe)
- Weather checks every **25 mi**

1. **Open (≈30s)** — Introduce Weather-Aware Truck Routing: React + Django app that picks the safest corridor using weather, cargo weight, and travel time.
2. **Inputs (≈1 min)** — Show start, end, leave-at time, cargo weight, 25 mi spacing. Hit **Compare routes**.
3. **Three corridors (≈2 min)** — Map with all options; click each corridor card; call out distance, duration, severe/high miles, avg risk. Streets / Satellite toggle if useful.
4. **Best pick (≈1–2 min)** — Preference order: fewest Severe → fewest High → lowest avg risk → shortest time. Read the reason line on the best pick.
5. **Checkpoint detail (≈2 min)** — Open a checkpoint; show **ETA**, wind/rain/snow, risk level, and **reasons** (mention a load override if it appears).
6. **48h outlook (≈1–2 min)** — Move the forecast slider; note **Corridor risk at +Nh** and the changing glow/markers.
7. **Close (≈30s)** — Point at the GitHub README (setup + risk table) and the live URL.
