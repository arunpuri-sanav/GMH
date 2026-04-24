# Rush Hour Tycoon (GMH)

Rush Hour Tycoon is a map-based simulation game.

In simple terms, this project shows:

- how delivery drivers move through city traffic,
- how route quality affects delivery speed,
- and how different routing strategies compare in business impact.

## What is the purpose?

The purpose is to demonstrate, in a visual and understandable way, why smarter routing matters for city delivery operations.

Instead of only showing API responses, the app turns routing data into:

- moving drivers on a real map,
- active delivery routes,
- score and performance metrics,
- comparison of "Grab-style" routing vs "legacy" routing.

## What happens in the app?

When you start the simulation:

1. The app loads a city scenario (Jakarta, Singapore, or Bangkok).
2. It generates drivers and delivery orders inside safe city bounds.
3. It fetches route data from Grab Maps APIs.
4. Drivers move along those routes over time.
5. The app updates score and performance metrics as deliveries complete.

## Main UI areas

- **MissionControl (right panel):**
  - Start/Pause
  - Level slider (1-5)
  - Route mode settings
  - Score and status
  - Matrix/raw diagnostics at higher levels
  - Performance audit summary

- **Splash info panel (left):**
  - quick explanation of game purpose
  - how to play
  - scoring basics

- **Map (center):**
  - drivers
  - packages/orders
  - active routes
  - optional debug city bounding box

## Route colors (current)

- **Cyan**: active routes currently being followed by drivers
- **Green**: Grab comparison route (when shown)
- **Red**: legacy comparison route (when shown)

## APIs used and how they are used

This app primarily uses Grab Maps APIs in a practical simulation loop:

- **Grab Maps Style/Tiles API**
  - Used to load the base map style in the browser.
  - This is what renders the actual city map background.

- **Grab Directions API**
  - Used to get road-following routes from one point to another.
  - The game compares:
    - motorcycle-first Grab logic (comparison route)
    - standard car/legacy logic (comparison route)
  - Active drivers then move along route geometry over time.

- **Grab Matrix API**
  - Used to estimate travel times across driver/order combinations.
  - At higher levels, raw matrix payload is shown in the Professional Dashboard.
  - ETA variance metrics are computed from matrix durations.

- **Grab Places Nearby API** (used during bootstrap)
  - Used to snap generated synthetic order points to nearby real-world POIs.
  - This helps order origins feel realistic instead of purely random map points.

## API-to-UI mapping (simple)

- **Map background** <- Style/Tiles
- **Route lines and moving driver paths** <- Directions
- **ETA variance + matrix JSON panel** <- Matrix
- **Order seed realism (near real businesses)** <- Places

## Business case (why this matters)

This project is not only a demo UI. It can act as a practical logistics sandbox (a lightweight digital twin) for enterprise conversations.

### 1) Visual ROI proof: Standard vs Grab

- Run two virtual fleets in the same city/time window:
  - one using standard routing assumptions
  - one using GrabMaps intelligence (motorcycle-first, local road knowledge)
- Show delivery and time delta directly on map.
- Business value: a clear, visual reason for clients to switch API/provider.

### 2) "What-if" stress testing

- Simulate disruption scenarios (weather, congestion spikes, closures).
- Show how routing and matrix behavior changes before real-world impact.
- Business value: risk planning without spending real fleet budget.

### 3) Capacity planning and batching logic

- Use matrix-driven assignment to test how many drivers are actually needed.
- Model effects of better dispatch and multi-order optimization.
- Business value: potential same-volume delivery with lower staffing cost.

### 4) Sustainability transition planning

- Use POI and routing intelligence to evaluate low-emission fleet operations.
- Model charger/energy constraints in simulation mode when needed.
- Business value: supports ESG planning and operations readiness.

### 5) Sales enablement: show, do not tell

- Replace static API claims with a live city scenario.
- Let stakeholders watch algorithms solve a messy, real-time map problem.
- Business value: stronger trust in data quality and platform capability.

## Why points exist

Points are the player's simple success indicator.

You gain points when deliveries complete, so points represent how efficiently operations are running.

## Files you should know

- `apps/rush-hour-tycoon.html`  
  page entry for the game

- `apps/rush-hour-tycoon-app.js`  
  main gameplay, map rendering, UI logic

- `apps/city_config.json`  
  city scenarios, centers, bounds, and names

- `apps/game_state_seed.json`  
  example seed session data

- `apps/LocationGenerator.js`  
  helper for generating valid in-city locations

## Run locally

Because browser modules and API calls are restricted on `file://`, run a local static server from project root:

```bash
python -m http.server 5500
```

Then open:

[http://localhost:5500/apps/rush-hour-tycoon.html](http://localhost:5500/apps/rush-hour-tycoon.html)

## Current status

This is an active prototype.

The project is intentionally iterative: features are being added, simplified, and refined quickly to keep the demo usable and clear.

