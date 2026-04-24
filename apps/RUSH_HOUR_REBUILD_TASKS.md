# Rush Hour Tycoon Rebuild Tasks

This file captures all project tasks requested so far, grouped by status.

## Done in Current Rebuild

- Replaced `rush-hour-tycoon-app.js` with a clean implementation.
- Stabilized map layer lifecycle for style/source/layer setup.
- Added deterministic city bounds constants for spawn/debug.
- Added driver and order seed bootstrap tied to city config.
- Implemented Places-based snapping during initial order generation.
- Implemented Grab Directions routing for active drivers.
- Implemented polyline decode support for encoded geometry responses.
- Added visible route layers:
  - aquamarine active driver routes
  - green Grab comparison route
  - red Legacy comparison route
- Added hard-visible debug bounding box rendering and fit-to-bounds behavior.
- Kept MissionControl and PerformanceAudit integration.

## Core Product Tasks (Requested So Far)

### Gameplay and Simulation

- [x] Tick loop for movement and scoring.
- [x] Delivery scoring by level.
- [ ] Proper SLA/failure rules and penalties (beyond simple delivery flow).
- [ ] Deterministic seed-loading mode from `game_state_seed.json`.

### GrabMaps Integrations

- [x] Tiles style loading.
- [x] Places snapping for order generation.
- [x] Directions API for movement and comparison routes.
- [ ] Matrix API driven global assignment board (currently simplified assignment path).
- [ ] Full endpoint compatibility matrix with graceful param fallbacks.

### UI / MissionControl

- [x] Start/pause controls.
- [x] Route legend and score/status.
- [x] Debug spawn bounding box toggle.
- [ ] Reintroduce city selector (removed during rollback).
- [ ] Reintroduce help/splash (disabled by default) if needed again.

### Sustainability and Ops

- [ ] EV/ICE differentiated energy behavior and charging reroute.
- [ ] ERP and cost model tuning by city and level.
- [ ] Carbon/fuel model calibration with configurable assumptions.

### Reliability / Quality

- [x] Rebuild to reduce style-load race complexity.
- [ ] Add runtime diagnostics panel (route decoded count, map layer health).
- [ ] Add regression checklist and scripted smoke tests.

## Immediate Next Tasks (Recommended)

1. Restore city switcher in clean architecture.
2. Reconnect matrix-based assignment to power multiple drivers at once.
3. Reintroduce sustainability (EV battery + charging reroute) on top of stable base.
4. Add seed-loader toggle (`random` vs `game_state_seed.json`) for demos.
