import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { motion } from "https://esm.sh/framer-motion@11.3.19";
import { create } from "https://esm.sh/zustand@4.5.4";
import htm from "https://esm.sh/htm@3.1.1";

import { fetchGrabDirections, fetchGrabMatrix, fetchGrabStyleVariant, getApiKeyFromWindow } from "../lib/grab-api.js";
import { getResultItems } from "../lib/utils.js";
import LocationGenerator from "./LocationGenerator.js";
import PerformanceAudit from "./PerformanceAudit.js";

const html = htm.bind(React.createElement);

const CITY_KEYS = {
  SINGAPORE: "singapore_orchard",
  JAKARTA: "jakarta_sudirman",
  BANGKOK: "bangkok_sukhumvit",
};

const CITY_BOUNDS = {
  SINGAPORE: { minLat: 1.295, maxLat: 1.315, minLng: 103.825, maxLng: 103.855 },
  JAKARTA: { minLat: -6.235, maxLat: -6.21, minLng: 106.795, maxLng: 106.825 },
  BANGKOK: { minLat: 13.72, maxLat: 13.75, minLng: 100.55, maxLng: 100.59 },
};

const CITY_LABELS = {
  SINGAPORE: "Singapore",
  JAKARTA: "Jakarta",
  BANGKOK: "Bangkok",
};
const CITY_DEFAULT_GAME_NAMES = {
  SINGAPORE: "Singapore: The Orchard Optimizer",
  JAKARTA: "Jakarta: The Sudirman Scramble",
  BANGKOK: "Bangkok: Sukhumvit Surge",
};

const LAYER = {
  driverRoutesSource: "rht-driver-routes-src",
  driverRoutesLayer: "rht-driver-routes-lyr",
  compareGrabSource: "rht-compare-grab-src",
  compareGrabLayer: "rht-compare-grab-lyr",
  compareLegacySource: "rht-compare-legacy-src",
  compareLegacyLayer: "rht-compare-legacy-lyr",
  boundsSource: "rht-bounds-src",
  boundsFillLayer: "rht-bounds-fill-lyr",
  boundsLineLayer: "rht-bounds-line-lyr",
  heatSource: "rht-heat-src",
  heatLayer: "rht-heat-lyr",
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const safePick = (obj, key, fallback) => (obj && key in obj ? obj[key] : fallback);

function randomPointInBounds(bounds) {
  const lat = bounds.minLat + Math.random() * (bounds.maxLat - bounds.minLat);
  const lng = bounds.minLng + Math.random() * (bounds.maxLng - bounds.minLng);
  return [lng, lat];
}

function decodePolyline(encoded, precision = 5) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const factor = Math.pow(10, precision);
  const out = [];
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

function isValidLngLat(coord) {
  return (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1]) &&
    Math.abs(coord[0]) <= 180 &&
    Math.abs(coord[1]) <= 90
  );
}

function normalizeRouteCoords(coords) {
  if (!Array.isArray(coords)) return [];
  return coords
    .map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const a = Number(coord[0]);
      const b = Number(coord[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return [b, a];
      if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return [a, b];
      return null;
    })
    .filter(Boolean);
}

function extractCoords(directionPayload) {
  const route = directionPayload?.routes?.[0];
  if (!route) return [];
  if (Array.isArray(route?.geometry?.coordinates)) {
    return normalizeRouteCoords(route.geometry.coordinates);
  }
  if (typeof route?.geometry === "string") {
    const p5 = normalizeRouteCoords(decodePolyline(route.geometry, 5));
    if (p5.length > 1) return p5;
    return normalizeRouteCoords(decodePolyline(route.geometry, 6));
  }
  return [];
}

function boundsFeature(cityKey) {
  const b = safePick(CITY_BOUNDS, cityKey, CITY_BOUNDS.SINGAPORE);
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [[
          [b.minLng, b.minLat],
          [b.maxLng, b.minLat],
          [b.maxLng, b.maxLat],
          [b.minLng, b.maxLat],
          [b.minLng, b.minLat],
        ]],
      },
    }],
  };
}

function ensureLineLayer(map, sourceId, layerId, color, width = 4, opacity = 0.9) {
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      paint: { "line-color": color, "line-width": width, "line-opacity": opacity },
    });
  }
}

const useGameStore = create((set, get) => ({
  cityKey: "JAKARTA",
  level: 1,
  started: false,
  debugBounds: true,
  showComparisonRoutes: false,
  splashVisible: true,
  cityGameNames: { ...CITY_DEFAULT_GAME_NAMES },
  moatGrabLogic: true,
  status: "Ready",
  totalScore: 0,
  erpCost: 0,
  etaVariance: null,
  sessionTick: 0,
  totalDeliveredOrders: 0,
  drivers: [],
  orders: [],
  matrixRawOutput: null,
  driverRoutes: {},
  routeComparison: { grab: [], legacy: [], grabDuration: 0, legacyDuration: 0 },
  performanceTotals: { timeSavedSeconds: 0, fuelSavedLiters: 0, carbonSavedKg: 0 },

  setCityKey: (cityKey) =>
    set({
      cityKey,
      started: false,
      status: "Ready",
      totalScore: 0,
      erpCost: 0,
      etaVariance: null,
      sessionTick: 0,
      totalDeliveredOrders: 0,
      drivers: [],
      orders: [],
      matrixRawOutput: null,
      driverRoutes: {},
      routeComparison: { grab: [], legacy: [], grabDuration: 0, legacyDuration: 0 },
      performanceTotals: { timeSavedSeconds: 0, fuelSavedLiters: 0, carbonSavedKg: 0 },
    }),
  setLevel: (level) => set({ level: clamp(Math.round(level), 1, 5) }),
  setStarted: (started) => set({ started }),
  setDebugBounds: (debugBounds) => set({ debugBounds }),
  setShowComparisonRoutes: (showComparisonRoutes) => set({ showComparisonRoutes }),
  setSplashVisible: (splashVisible) => set({ splashVisible }),
  setCityGameNames: (cityGameNames) => set({ cityGameNames }),
  setMoatGrabLogic: (moatGrabLogic) => set({ moatGrabLogic }),
  setStatus: (status) => set({ status }),
  setDrivers: (drivers) => set({ drivers }),
  setOrders: (orders) => set({ orders }),
  setMatrixRawOutput: (matrixRawOutput) => set({ matrixRawOutput }),
  setEtaVariance: (etaVariance) => set({ etaVariance }),
  setDriverRoute: (driverId, route) =>
    set({ driverRoutes: { ...get().driverRoutes, [driverId]: route } }),
  setComparison: (routeComparison) => set({ routeComparison }),
  addPerformance: (d) => {
    const p = get().performanceTotals;
    set({
      performanceTotals: {
        timeSavedSeconds: p.timeSavedSeconds + d.timeSavedSeconds,
        fuelSavedLiters: p.fuelSavedLiters + d.fuelSavedLiters,
        carbonSavedKg: p.carbonSavedKg + d.carbonSavedKg,
      },
    });
  },
  tick: () => {
    const s = get();
    if (!s.started) return;
    const bounds = safePick(CITY_BOUNDS, s.cityKey, CITY_BOUNDS.SINGAPORE);
    const nextDrivers = s.drivers.map((d) => ({ ...d, lngLat: [...d.lngLat] }));
    const nextOrders = s.orders.map((o) => ({ ...o }));
    const nextRoutes = { ...s.driverRoutes };
    let scoreDelta = 0;
    let deliveredDelta = 0;
    let erpDelta = 0;

    for (const d of nextDrivers) {
      const route = nextRoutes[d.id];
      if (!route || !Array.isArray(route.coords) || route.coords.length < 2) continue;
      const nextCursor = Math.min(route.cursor + 4, route.coords.length - 1);
      route.cursor = nextCursor;
      const stepCoord = route.coords[nextCursor];
      if (!isValidLngLat(stepCoord)) {
        delete nextRoutes[d.id];
        d.status = "idle";
        d.orderId = null;
        continue;
      }
      d.lngLat = stepCoord;
      if (nextCursor >= route.coords.length - 1) {
        d.status = "idle";
        d.orderId = null;
        delete nextRoutes[d.id];
        const idx = nextOrders.findIndex((o) => o.id === route.orderId);
        if (idx >= 0) {
          nextOrders.splice(idx, 1);
          scoreDelta += 120 + s.level * 35;
          deliveredDelta += 1;
        }
      }
      d.lngLat = [clamp(d.lngLat[0], bounds.minLng, bounds.maxLng), clamp(d.lngLat[1], bounds.minLat, bounds.maxLat)];
      // Driver movement only (no EV-specific branch).
    }

    set({
      drivers: nextDrivers,
      orders: nextOrders,
      driverRoutes: nextRoutes,
      sessionTick: s.sessionTick + 1,
      totalScore: s.totalScore + scoreDelta,
      erpCost: s.erpCost + erpDelta,
      totalDeliveredOrders: s.totalDeliveredOrders + deliveredDelta,
      status: `Running | drivers=${nextDrivers.length} | orders=${nextOrders.length}`,
    });
  },
}));

function useCityGameNames() {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch("/apps/city_config.json");
        if (!response.ok) return;
        const config = await response.json();
        if (cancelled) return;
        const names = {
          SINGAPORE: config?.cities?.[CITY_KEYS.SINGAPORE]?.name || CITY_DEFAULT_GAME_NAMES.SINGAPORE,
          JAKARTA: config?.cities?.[CITY_KEYS.JAKARTA]?.name || CITY_DEFAULT_GAME_NAMES.JAKARTA,
          BANGKOK: config?.cities?.[CITY_KEYS.BANGKOK]?.name || CITY_DEFAULT_GAME_NAMES.BANGKOK,
        };
        useGameStore.getState().setCityGameNames(names);
      } catch {
        // Keep defaults if config fails to load.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);
}

function useBootstrapData() {
  const cityKey = useGameStore((s) => s.cityKey);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const apiKey = getApiKeyFromWindow();
      if (!apiKey) return;
      const cfg = await (await fetch("/apps/city_config.json")).json();
      const generator = new LocationGenerator(cfg);
      const cityName = CITY_KEYS[cityKey];
      const bounds = safePick(CITY_BOUNDS, cityKey, CITY_BOUNDS.SINGAPORE);

      const drivers = Array.from({ length: 8 }, (_, i) => ({
        id: `DRV_${String(i + 1).padStart(2, "0")}`,
        lngLat: randomPointInBounds(bounds),
        status: "idle",
        type: i % 2 ? "MOTORCYCLE" : "CAR",
        orderId: null,
      }));

      const seeds = generator.generateOrderCluster(cityName, 10);
      const snapped = await Promise.all(
        seeds.map(async (seed, i) => {
          const r = await fetch(
            `https://maps.grab.com/api/v1/maps/place/v2/nearby?location=${seed.lat},${seed.lng}&radius=0.6&limit=5`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
          );
          const data = r.ok ? await r.json() : {};
          const items = getResultItems(data);
          const pick = items[0];
          const drop = randomPointInBounds(bounds);
          return {
            id: `ORD_${i + 1}`,
            pickup: pick ? [pick.lng, pick.lat] : [seed.lng, seed.lat],
            dropoff: drop,
            status: "pending",
          };
        }),
      );
      if (cancelled) return;
      useGameStore.getState().setDrivers(drivers);
      useGameStore.getState().setOrders(snapped);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [cityKey]);
}

function useRoutingEngine() {
  const started = useGameStore((s) => s.started);
  const cityKey = useGameStore((s) => s.cityKey);
  const moatGrabLogic = useGameStore((s) => s.moatGrabLogic);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const run = async () => {
      const apiKey = getApiKeyFromWindow();
      if (!apiKey) return;
      const s = useGameStore.getState();
      const idle = s.drivers.find((d) => d.status === "idle");
      const pending = s.orders.find((o) => o.status === "pending");
      if (idle && pending) {
        try {
          const grabRes = await fetchGrabDirections(apiKey, {
            fromLngLat: idle.lngLat,
            toLngLat: pending.dropoff,
            profile: "motorcycle",
            allowAlleyways: true,
          });
          const legacyRes = await fetchGrabDirections(apiKey, {
            fromLngLat: idle.lngLat,
            toLngLat: pending.dropoff,
            profile: "driving",
            allowAlleyways: false,
          });
          const grab = extractCoords(grabRes);
          const legacy = extractCoords(legacyRes);
          const grabDuration = Number(grabRes?.routes?.[0]?.duration || 0);
          const legacyDuration = Number(legacyRes?.routes?.[0]?.duration || 0);
          const chosen = moatGrabLogic ? grab : legacy;
          if (!cancelled && chosen.length > 1) {
            useGameStore.getState().setDriverRoute(idle.id, {
              orderId: pending.id,
              coords: normalizeRouteCoords(chosen),
              cursor: 0,
            });
            useGameStore.setState((st) => ({
              ...st,
              drivers: st.drivers.map((d) => (d.id === idle.id ? { ...d, status: "busy", orderId: pending.id } : d)),
            }));
          }
          useGameStore.getState().setComparison({ grab, legacy, grabDuration, legacyDuration });
          useGameStore.getState().addPerformance({
            timeSavedSeconds: Math.max(0, legacyDuration - grabDuration),
            fuelSavedLiters: Math.max(0, legacyDuration - grabDuration) / 60 * 0.02,
            carbonSavedKg: Math.max(0, legacyDuration - grabDuration) / 60 * 0.02 * 2.31,
          });
        } catch {
          useGameStore.getState().setStatus("Routing assignment retrying...");
        }
      }
    };
    void run();
    const id = window.setInterval(run, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [started, cityKey, moatGrabLogic]);
}

function useMatrixEngine() {
  const started = useGameStore((s) => s.started);
  const moatGrabLogic = useGameStore((s) => s.moatGrabLogic);
  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    const run = async () => {
      const apiKey = getApiKeyFromWindow();
      if (!apiKey) return;
      const s = useGameStore.getState();
      const idle = s.drivers.filter((d) => d.status === "idle").slice(0, 5);
      const pending = s.orders.filter((o) => o.status === "pending").slice(0, 10);
      if (!idle.length || !pending.length) return;
      try {
        const payload = await fetchGrabMatrix(apiKey, {
          sourcesLngLat: idle.map((d) => d.lngLat),
          destinationsLngLat: pending.map((o) => o.dropoff),
          profile: moatGrabLogic ? "motorcycle" : "driving",
        });
        if (cancelled) return;
        useGameStore.getState().setMatrixRawOutput(payload);
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        const durations = rows.flatMap((r) =>
          Array.isArray(r) ? r.map((c) => Number(c?.duration ?? c?.time ?? c?.value)).filter(Number.isFinite) : [],
        );
        if (durations.length) {
          const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
          const variance = durations.reduce((a, b) => a + (b - avg) ** 2, 0) / durations.length;
          useGameStore.getState().setEtaVariance(Math.sqrt(variance) / 60);
        }
      } catch {
        // keep previous matrix snapshot
      }
    };
    void run();
    const id = window.setInterval(run, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [started, moatGrabLogic]);
}

function useTickLoop() {
  useEffect(() => {
    const id = window.setInterval(() => useGameStore.getState().tick(), 600);
    return () => window.clearInterval(id);
  }, []);
}

function useMapLayer() {
  const mapRef = useRef(null);
  const driverMarkersRef = useRef(new Map());
  const orderMarkersRef = useRef(new Map());
  const poiMarkersRef = useRef(new Map());
  const [mapReadyTick, setMapReadyTick] = useState(0);
  const snapshot = useGameStore((s) => ({
    cityKey: s.cityKey,
    debugBounds: s.debugBounds,
    showComparisonRoutes: s.showComparisonRoutes,
    drivers: s.drivers,
    orders: s.orders,
    driverRoutes: s.driverRoutes,
    routeComparison: s.routeComparison,
    level: s.level,
  }));

  useEffect(() => {
    let disposed = false;
    const boot = async () => {
      const apiKey = getApiKeyFromWindow();
      if (!apiKey) return;
      const styleRes = await fetchGrabStyleVariant(apiKey, { theme: "day", traffic: true });
      if (!styleRes.ok || disposed) return;
      const style = await styleRes.json();
      const b = safePick(CITY_BOUNDS, snapshot.cityKey, CITY_BOUNDS.SINGAPORE);
      const map = new maplibregl.Map({
        container: "map",
        style,
        center: [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2],
        zoom: 14,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-left");
      map.on("load", () => {
        ensureLineLayer(map, LAYER.driverRoutesSource, LAYER.driverRoutesLayer, "#00e5ff", 4, 0.95);
        ensureLineLayer(map, LAYER.compareGrabSource, LAYER.compareGrabLayer, "#14f195", 5, 0.9);
        ensureLineLayer(map, LAYER.compareLegacySource, LAYER.compareLegacyLayer, "#ef4444", 5, 0.9);
        setMapReadyTick((x) => x + 1);
      });
      mapRef.current = map;
    };
    void boot();
    return () => {
      disposed = true;
      driverMarkersRef.current.forEach((m) => m.remove());
      orderMarkersRef.current.forEach((m) => m.remove());
      poiMarkersRef.current.forEach((m) => m.remove());
      driverMarkersRef.current.clear();
      orderMarkersRef.current.clear();
      poiMarkersRef.current.clear();
      mapRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    ensureLineLayer(map, LAYER.driverRoutesSource, LAYER.driverRoutesLayer, "#00e5ff", 4, 0.95);
    ensureLineLayer(map, LAYER.compareGrabSource, LAYER.compareGrabLayer, "#14f195", 5, 0.9);
    ensureLineLayer(map, LAYER.compareLegacySource, LAYER.compareLegacyLayer, "#ef4444", 5, 0.9);
    const nextDriverIds = new Set(snapshot.drivers.map((d) => d.id));
    const visibleOrders = snapshot.orders.slice(0, 5);
    const nextOrderIds = new Set(visibleOrders.map((o) => o.id));
    const nextPoiIds = new Set();
    for (const [id, marker] of driverMarkersRef.current.entries()) {
      if (!nextDriverIds.has(id)) {
        marker.remove();
        driverMarkersRef.current.delete(id);
      }
    }
    for (const [id, marker] of orderMarkersRef.current.entries()) {
      if (!nextOrderIds.has(id)) {
        marker.remove();
        orderMarkersRef.current.delete(id);
      }
    }
    for (const [id, marker] of poiMarkersRef.current.entries()) {
      if (!nextPoiIds.has(id)) {
        marker.remove();
        poiMarkersRef.current.delete(id);
      }
    }

    snapshot.drivers.forEach((d) => {
      const existing = driverMarkersRef.current.get(d.id);
      if (existing) {
        existing.setLngLat(d.lngLat);
        return;
      }
      const el = document.createElement("div");
      const emojiMode = snapshot.level <= 1;
      if (emojiMode) {
        el.textContent = d.type === "CAR" ? "🚗" : "🏍️";
        el.style.fontSize = "18px";
      } else {
        el.style.width = "12px";
        el.style.height = "12px";
        el.style.borderRadius = "999px";
        el.style.background = d.type === "CAR" ? "#34d399" : "#60a5fa";
        el.style.border = "2px solid rgba(255,255,255,0.9)";
      }
      const marker = new maplibregl.Marker({ element: el }).setLngLat(d.lngLat).addTo(map);
      driverMarkersRef.current.set(d.id, marker);
    });
    visibleOrders.forEach((o) => {
      const existing = orderMarkersRef.current.get(o.id);
      if (existing) {
        existing.setLngLat(o.dropoff);
        return;
      }
      const el = document.createElement("div");
      if (snapshot.level <= 1) {
        el.textContent = "📦";
        el.style.fontSize = "16px";
      } else {
        el.style.width = "9px";
        el.style.height = "9px";
        el.style.borderRadius = "999px";
        el.style.background = "#fb923c";
      }
      const marker = new maplibregl.Marker({ element: el }).setLngLat(o.dropoff).addTo(map);
      orderMarkersRef.current.set(o.id, marker);
    });

    // Charging POI markers removed with EV mode for now.

    const driverFeatures = Object.entries(snapshot.driverRoutes).map(([id, r]) => ({
      type: "Feature",
      properties: { id },
      geometry: { type: "LineString", coordinates: r.coords.slice(r.cursor || 0) },
    }));
    map.getSource(LAYER.driverRoutesSource).setData({ type: "FeatureCollection", features: driverFeatures });
    map.getSource(LAYER.compareGrabSource).setData({
      type: "FeatureCollection",
      features:
        snapshot.showComparisonRoutes && snapshot.routeComparison.grab.length > 1
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: snapshot.routeComparison.grab } }]
          : [],
    });
    map.getSource(LAYER.compareLegacySource).setData({
      type: "FeatureCollection",
      features:
        snapshot.showComparisonRoutes && snapshot.routeComparison.legacy.length > 1
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: snapshot.routeComparison.legacy } }]
          : [],
    });

    const boundsFc = boundsFeature(snapshot.cityKey);
    if (!map.getSource(LAYER.boundsSource)) {
      map.addSource(LAYER.boundsSource, { type: "geojson", data: boundsFc });
      map.addLayer({
        id: LAYER.boundsFillLayer,
        type: "fill",
        source: LAYER.boundsSource,
        paint: { "fill-color": "#ff00ff", "fill-opacity": 0 },
      });
      map.addLayer({
        id: LAYER.boundsLineLayer,
        type: "line",
        source: LAYER.boundsSource,
        paint: { "line-color": "#ff00ff", "line-width": snapshot.debugBounds ? 1.2 : 0, "line-opacity": snapshot.debugBounds ? 0.95 : 0 },
      });
    } else {
      map.getSource(LAYER.boundsSource).setData(boundsFc);
      map.setPaintProperty(LAYER.boundsFillLayer, "fill-opacity", 0);
      map.setPaintProperty(LAYER.boundsLineLayer, "line-width", snapshot.debugBounds ? 1.2 : 0);
      map.setPaintProperty(LAYER.boundsLineLayer, "line-opacity", snapshot.debugBounds ? 1 : 0);
    }

    if (snapshot.level >= 3) {
      const heatFc = {
        type: "FeatureCollection",
        features: snapshot.orders.map((o) => ({
          type: "Feature",
          properties: { weight: 1 },
          geometry: { type: "Point", coordinates: o.pickup || o.dropoff },
        })),
      };
      if (!map.getSource(LAYER.heatSource)) {
        map.addSource(LAYER.heatSource, { type: "geojson", data: heatFc });
      } else {
        map.getSource(LAYER.heatSource).setData(heatFc);
      }
      if (!map.getLayer(LAYER.heatLayer)) {
        map.addLayer({
          id: LAYER.heatLayer,
          type: "heatmap",
          source: LAYER.heatSource,
          paint: {
            "heatmap-intensity": 0.8,
            "heatmap-radius": 22,
            "heatmap-opacity": 0.62,
          },
        });
      }
    } else {
      if (map.getLayer(LAYER.heatLayer)) map.removeLayer(LAYER.heatLayer);
      if (map.getSource(LAYER.heatSource)) map.removeSource(LAYER.heatSource);
    }
  }, [snapshot, mapReadyTick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = safePick(CITY_BOUNDS, snapshot.cityKey, CITY_BOUNDS.SINGAPORE);
    map.flyTo({
      center: [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2],
      zoom: 14,
      duration: 700,
    });
  }, [snapshot.cityKey]);
}

function MissionControl() {
  const s = useGameStore();
  return html`
    <${motion.aside}
      initial=${{ opacity: 0, x: 20 }}
      animate=${{ opacity: 1, x: 0 }}
      className="fixed right-4 top-20 z-20 w-[380px] rounded-2xl border border-white/25 bg-slate-950/75 p-3 text-white shadow-2xl backdrop-blur-sm"
    >
      <h2 className="text-xl font-bold">MissionControl</h2>
      <div className="mt-1 rounded-lg border border-cyan-400/40 bg-cyan-900/20 p-2 text-sm font-semibold text-cyan-200">
        ${safePick(s.cityGameNames, s.cityKey, safePick(CITY_DEFAULT_GAME_NAMES, s.cityKey, "City Scenario"))}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs text-slate-300">City</span>
        <select
          className="flex-1 rounded-md border border-white/20 bg-slate-900/60 p-1.5 text-sm text-white"
          value=${s.cityKey}
          onChange=${(e) => useGameStore.getState().setCityKey(e.target.value)}
        >
          <option value="JAKARTA">Jakarta</option>
          <option value="SINGAPORE">Singapore</option>
          <option value="BANGKOK">Bangkok</option>
        </select>
      </div>
      <${PerformanceAudit}
        started=${s.started}
        sessionTick=${s.sessionTick}
        performanceTotals=${s.performanceTotals}
        totalDeliveredOrders=${s.totalDeliveredOrders}
      />

      <div className="mt-2 flex gap-3">
        <div className="flex flex-col items-center">
          <span className="text-xs text-slate-300">Level ${s.level}</span>
          <input
            className="h-24"
            type="range"
            min="1"
            max="5"
            step="1"
            value=${s.level}
            onChange=${(e) => useGameStore.getState().setLevel(Number(e.target.value))}
            style=${{ writingMode: "vertical-lr", direction: "rtl" }}
          />
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded bg-cyan-700/70 px-2 py-1.5 text-sm" onClick=${() => useGameStore.getState().setStarted(!s.started)}>
              ${s.started ? "Pause" : "Start"}
            </button>
            <button className="rounded bg-white/10 px-2 py-1.5 text-xs" onClick=${() => useGameStore.getState().setDebugBounds(!s.debugBounds)}>
              ${s.debugBounds ? "Hide Bounds" : "Show Bounds"}
            </button>
          </div>
          <div className="mt-1 rounded-lg bg-white/10 p-2 text-sm">Total Score: ${s.totalScore.toLocaleString()}</div>
          <div className="mt-1 text-[11px] text-slate-300">
            Cyan active routes only | Grab vs Legacy metric:
            ${s.routeComparison ? ` ${Math.round((s.routeComparison.grabDuration || 0) / 60)}m vs ${Math.round((s.routeComparison.legacyDuration || 0) / 60)}m` : " n/a"}
          </div>
          ${s.level >= 3
            ? html`
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white/10 p-2 text-xs">
                    ETA Var: ${s.etaVariance ? `${s.etaVariance.toFixed(2)}m` : "warming"}
                  </div>
                  <div className="rounded-lg bg-white/10 p-2 text-xs">Heatmap: ON</div>
                </div>
              `
            : null}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/20 bg-black/30 p-2">
          <div className="mb-1 text-slate-300">Moat</div>
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked=${s.moatGrabLogic}
              onChange=${(e) => useGameStore.getState().setMoatGrabLogic(e.target.checked)}
            />
            ${s.moatGrabLogic ? "Grab ON" : "Legacy"}
          </label>
        </div>
        <div className="rounded-lg border border-white/20 bg-black/30 p-2">
          <div className="mb-1 text-slate-300">Mode</div>
          <div className="text-[11px] text-slate-300">Fleet simulation active</div>
        </div>
      </div>

      ${s.level >= 5
        ? html`
            <div className="mt-2 rounded-lg border border-white/20 bg-black/30 p-2 text-xs">
              <div className="mb-1 text-slate-300">Professional Dashboard</div>
              <div className="text-[11px] text-slate-200">ERP: $${s.erpCost.toFixed(2)}</div>
              <pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-950/80 p-2 text-[10px] text-emerald-200">
                ${s.matrixRawOutput ? JSON.stringify(s.matrixRawOutput, null, 2) : "Matrix JSON not available yet."}
              </pre>
            </div>
          `
        : null}

      <p className="mt-1 text-xs text-slate-300">${s.status}</p>
    <//>
  `;
}

function SplashFixture() {
  const splashVisible = useGameStore((s) => s.splashVisible);
  const setSplashVisible = useGameStore((s) => s.setSplashVisible);
  if (!splashVisible) return null;
  return html`
    <aside
      className="fixed left-4 top-20 z-20 w-[360px] rounded-2xl border border-white/25 bg-slate-950/75 p-4 text-white shadow-2xl backdrop-blur-sm"
      aria-label="Rush Hour Tycoon splash info"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Rush Hour Tycoon</h2>
        <button
          className="rounded border border-white/30 bg-white/10 px-2 py-0.5 text-xs"
          title="Hide splash panel"
          onClick=${() => setSplashVisible(false)}
        >
          Hide
        </button>
      </div>
      <p className="mt-2 text-sm text-slate-200">
        Logistics strategy simulator powered by GrabMaps APIs.
      </p>

      <div className="mt-3 rounded-lg border border-white/20 bg-black/30 p-3 text-xs">
        <div className="mb-1 text-slate-300">Aim</div>
        <div className="text-slate-200">
          Complete deliveries efficiently while balancing ETA, routing quality, and operating cost.
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-white/20 bg-black/30 p-3 text-xs">
        <div className="mb-1 text-slate-300">How to Play</div>
        <div className="text-slate-200">- Press Start in MissionControl to run simulation.</div>
        <div className="text-slate-200">- Increase level (1-5) to unlock advanced analytics.</div>
        <div className="text-slate-200">- Toggle Grab Logic for motorcycle-first vs legacy car behavior.</div>
      </div>

      <div className="mt-3 rounded-lg border border-white/20 bg-black/30 p-3 text-xs">
        <div className="mb-1 text-slate-300">Scoring</div>
        <div className="text-slate-200">- Delivery points: 120 + (level x 35).</div>
        <div className="text-slate-200">- Performance audit tracks time, fuel/carbon savings, and OPH uplift.</div>
      </div>
    </aside>
  `;
}

function SplashToggle() {
  const splashVisible = useGameStore((s) => s.splashVisible);
  const setSplashVisible = useGameStore((s) => s.setSplashVisible);
  return html`
    <button
      className="fixed left-4 top-20 z-30 rounded-full border border-white/30 bg-slate-950/80 px-3 py-1 text-xs text-white shadow-lg backdrop-blur-sm"
      title=${splashVisible ? "Hide splash panel" : "Show splash panel"}
      onClick=${() => setSplashVisible(!splashVisible)}
    >
      ${splashVisible ? "ⓘ Hide Info" : "ⓘ Show Info"}
    </button>
  `;
}

function App() {
  useCityGameNames();
  useBootstrapData();
  useRoutingEngine();
  useMatrixEngine();
  useTickLoop();
  useMapLayer();
  return html`
    <div>
      <${SplashToggle} />
      <${SplashFixture} />
      <${MissionControl} />
    </div>
  `;
}

const root = document.getElementById("rushHourRoot");
if (root) createRoot(root).render(html`<${App} />`);
