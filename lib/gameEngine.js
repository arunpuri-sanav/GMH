import { createStore } from "https://esm.sh/zustand@4.5.4/vanilla";

import {
  fetchGrabDirections,
  fetchGrabMatrix,
  getApiKeyFromWindow,
} from "./grab-api.js";

const TICK_MS = 2000;
const MATRIX_REFRESH_MS = 10000;
const ROAD_CLOSURE_SOURCE_ID = "game-road-closures-source";
const ROAD_CLOSURE_LAYER_ID = "game-road-closures-layer";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toLngLat(driver) {
  return [driver.lng, driver.lat];
}

function toOrderDestination(order) {
  return [order.dropoffLng, order.dropoffLat];
}

function parseDurationCell(cell) {
  return Number(cell?.duration ?? cell?.time ?? cell?.value);
}

function createRoadClosurePolygon(center, size = 0.012) {
  const [lng, lat] = center;
  return {
    type: "Feature",
    properties: { kind: "road_closure" },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lng - size, lat - size * 0.6],
        [lng + size * 0.9, lat - size * 0.2],
        [lng + size * 0.6, lat + size * 0.8],
        [lng - size * 0.8, lat + size * 0.5],
        [lng - size, lat - size * 0.6],
      ]],
    },
  };
}

function pickAssignments(idleDrivers, pendingOrders, matrixRows) {
  const candidates = [];
  matrixRows.forEach((row, dIdx) => {
    row.forEach((cell, oIdx) => {
      const duration = parseDurationCell(cell);
      if (Number.isFinite(duration)) candidates.push({ dIdx, oIdx, duration });
    });
  });
  candidates.sort((a, b) => a.duration - b.duration);

  const usedDrivers = new Set();
  const usedOrders = new Set();
  const assignments = [];

  for (const item of candidates) {
    if (usedDrivers.has(item.dIdx) || usedOrders.has(item.oIdx)) continue;
    usedDrivers.add(item.dIdx);
    usedOrders.add(item.oIdx);
    assignments.push({
      driverId: idleDrivers[item.dIdx].id,
      orderId: pendingOrders[item.oIdx].id,
      durationSeconds: item.duration,
    });
  }
  return assignments;
}

export function createGameEngine({
  center = [103.8198, 1.3521],
  defaultProfile = "motorcycle",
  departureHour = 18,
} = {}) {
  let tickTimer = null;
  let matrixTimer = null;

  const store = createStore((set, get) => ({
    Drivers: [],
    Orders: [],
    ComplexityLevel: 1,
    routingProfile: defaultProfile,
    departureHour,
    assignments: [],
    matrixSnapshot: null,
    roadClosures: [],
    driverRoutes: {},
    status: "idle",

    setDrivers: (Drivers) => set({ Drivers }),
    setOrders: (Orders) => set({ Orders }),
    setComplexityLevel: (ComplexityLevel) => set({ ComplexityLevel: clamp(Math.round(ComplexityLevel), 1, 5) }),
    setRoutingProfile: (routingProfile) => set({ routingProfile }),

    start: () => {
      const { stop } = get();
      stop();
      tickTimer = window.setInterval(() => {
        void get().tick();
      }, TICK_MS);
      matrixTimer = window.setInterval(() => {
        void get().refreshMatrix();
      }, MATRIX_REFRESH_MS);
      set({ status: "running" });
    },

    stop: () => {
      if (tickTimer) window.clearInterval(tickTimer);
      if (matrixTimer) window.clearInterval(matrixTimer);
      tickTimer = null;
      matrixTimer = null;
      set({ status: "stopped" });
    },

    tick: async () => {
      const state = get();
      const routes = { ...state.driverRoutes };
      const nextDrivers = state.Drivers.map((driver) => ({ ...driver }));
      const nextOrders = state.Orders.map((order) => ({ ...order }));

      for (const driver of nextDrivers) {
        if (driver.status !== "busy") continue;
        const route = routes[driver.id];
        if (!route || !Array.isArray(route.coordinates) || route.coordinates.length === 0) {
          driver.status = "idle";
          continue;
        }
        const nextIndex = clamp((route.cursor ?? 0) + 1, 0, route.coordinates.length - 1);
        const [lng, lat] = route.coordinates[nextIndex];
        driver.lng = lng;
        driver.lat = lat;
        route.cursor = nextIndex;

        if (nextIndex >= route.coordinates.length - 1) {
          driver.status = "idle";
          driver.battery = Math.max(0, Number(driver.battery ?? 100) - 4);
          const orderIdx = nextOrders.findIndex((o) => o.id === route.orderId);
          if (orderIdx >= 0) nextOrders.splice(orderIdx, 1);
          delete routes[driver.id];
        }
      }

      set({ Drivers: nextDrivers, Orders: nextOrders, driverRoutes: routes });
    },

    refreshMatrix: async () => {
      const apiKey = getApiKeyFromWindow();
      if (!apiKey) return;

      const state = get();
      const idleDrivers = state.Drivers.filter((d) => d.status === "idle");
      const pendingOrders = state.Orders.filter((o) => o.status === "pending");
      if (!idleDrivers.length || !pendingOrders.length) {
        set({ assignments: [], matrixSnapshot: null });
        return;
      }

      try {
        const payload = await fetchGrabMatrix(apiKey, {
          sourcesLngLat: idleDrivers.map(toLngLat),
          destinationsLngLat: pendingOrders.map(toOrderDestination),
          profile: state.routingProfile,
        });
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const assignments = pickAssignments(idleDrivers, pendingOrders, rows);
        set({ assignments, matrixSnapshot: payload });
        if (!assignments.length) return;

        const plannedDrivers = state.Drivers.map((driver) => ({ ...driver }));
        const plannedOrders = state.Orders.map((order) => ({ ...order }));
        const nextRoutes = { ...state.driverRoutes };

        for (const item of assignments) {
          const driver = plannedDrivers.find((d) => d.id === item.driverId);
          const order = plannedOrders.find((o) => o.id === item.orderId);
          if (!driver || !order) continue;
          if (driver.status !== "idle" || order.status !== "pending") continue;

          const direction = await fetchGrabDirections(apiKey, {
            fromLngLat: [driver.lng, driver.lat],
            toLngLat: [order.dropoffLng, order.dropoffLat],
            profile: state.routingProfile,
            avoidTolls: state.ComplexityLevel > 4,
            allowAlleyways: true,
          });
          const coords = direction?.routes?.[0]?.geometry?.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) continue;

          driver.status = "busy";
          order.status = "active";
          nextRoutes[driver.id] = {
            orderId: order.id,
            coordinates: coords,
            cursor: 0,
          };
        }
        set({ Drivers: plannedDrivers, Orders: plannedOrders, driverRoutes: nextRoutes });
      } catch (error) {
        set({ status: `matrix-refresh-error: ${error.message}` });
      }
    },

    triggerMonsoon: async (map) => {
      const state = get();
      const closures = [
        createRoadClosurePolygon(center, 0.014),
        createRoadClosurePolygon([center[0] + 0.02, center[1] - 0.015], 0.01),
      ];
      set({
        roadClosures: closures,
        status: "Monsoon triggered: road closures active, recalculating routes.",
      });

      if (map) {
        const data = { type: "FeatureCollection", features: closures };
        if (map.getSource(ROAD_CLOSURE_SOURCE_ID)) {
          map.getSource(ROAD_CLOSURE_SOURCE_ID).setData(data);
        } else {
          map.addSource(ROAD_CLOSURE_SOURCE_ID, { type: "geojson", data });
          map.addLayer({
            id: ROAD_CLOSURE_LAYER_ID,
            type: "fill",
            source: ROAD_CLOSURE_SOURCE_ID,
            paint: {
              "fill-color": "#ef4444",
              "fill-opacity": 0.3,
            },
          });
        }
      }

      const apiKey = getApiKeyFromWindow();
      if (!apiKey) return;
      const rerouteDrivers = state.Drivers.filter((driver) => driver.status === "busy");
      if (!rerouteDrivers.length) return;

      const nextRoutes = { ...state.driverRoutes };
      for (const driver of rerouteDrivers) {
        const routeState = nextRoutes[driver.id];
        if (!routeState) continue;
        const order = state.Orders.find((o) => o.id === routeState.orderId);
        if (!order) continue;
        try {
          const direction = await fetchGrabDirections(apiKey, {
            fromLngLat: [driver.lng, driver.lat],
            toLngLat: [order.dropoffLng, order.dropoffLat],
            profile: state.routingProfile,
            avoidTolls: true,
            allowAlleyways: false,
          });
          const coords = direction?.routes?.[0]?.geometry?.coordinates;
          if (Array.isArray(coords) && coords.length > 1) {
            nextRoutes[driver.id] = {
              orderId: order.id,
              coordinates: coords,
              cursor: 0,
            };
          }
        } catch {
          // Keep old route if recalc fails.
        }
      }
      set({ driverRoutes: nextRoutes });
    },
  }));

  return store;
}

export function createDefaultGameEngine() {
  return createGameEngine();
}
