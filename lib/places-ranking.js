/**
 * Nearby → matrix / per-leg routing scores for ranking showcase flows.
 */

import { buildDepartureTime, getTimeWeight } from "./utils.js";

/** @param {object[]} items @param {*} map MapLibre map or null */
export function getVisibleCandidates(items, map) {
  if (!map) return items;
  const bounds = map.getBounds();
  return items.filter((item) => bounds.contains([item.lng, item.lat]));
}

/**
 * @param {(endpoint: string, params?: object) => Promise<unknown>} callGrab
 */
export async function rankPlacesByRouting(callGrab, items, city, hour, appendLog) {
  const matrixMetrics = await getRouteMetricsByMatrix(callGrab, city, items, hour, appendLog);
  if (matrixMetrics.length) {
    const matrixByIndex = new Map(matrixMetrics.map((m) => [m.idx, m]));
    const rankedFromMatrix = items
      .map((item, idx) => {
        const m = matrixByIndex.get(idx);
        if (!m) return null;
        const scored = {
          ...item,
          routeDistanceMeters: m.routeDistanceMeters,
          routeDurationSeconds: m.routeDurationSeconds,
        };
        scored.rankingScore =
          scored.routeDistanceMeters +
          scored.routeDurationSeconds * getTimeWeight(hour, city.profile);
        return scored;
      })
      .filter(Boolean)
      .sort((a, b) => a.rankingScore - b.rankingScore);
    if (rankedFromMatrix.length) {
      appendLog(`Matrix ranking used (${rankedFromMatrix.length} routes).`);
      return rankedFromMatrix;
    }
  }

  appendLog("Matrix unavailable/empty; falling back to per-route checks.");
  const withMetrics = await Promise.all(
    items.map(async (item) => {
      const metrics = await getRouteMetrics(callGrab, city, item, hour, appendLog);
      if (!metrics) return null;
      const scored = { ...item, ...metrics };
      scored.rankingScore =
        scored.routeDistanceMeters +
        scored.routeDurationSeconds * getTimeWeight(hour, city.profile);
      return scored;
    }),
  );
  return withMetrics
    .filter(Boolean)
    .sort((a, b) => a.rankingScore - b.rankingScore);
}

export async function getRouteMetricsByMatrix(callGrab, city, items, hour, appendLog) {
  try {
    const departureIso = buildDepartureTime(hour);
    const source = `${city.center[0]},${city.center[1]}`;
    const destinations = items.map((item) => `${item.lng},${item.lat}`);

    const payload = await callGrab("/api/v1/maps/eta/v1/matrix", {
      sources: source,
      destinations,
      profile: city.profile,
      departure_time: departureIso,
    });

    const rows = payload?.rows || payload?.matrix || payload?.durations || [];
    const firstRow = Array.isArray(rows) ? rows[0] || rows : [];
    if (!Array.isArray(firstRow)) return [];

    const out = [];
    firstRow.forEach((cell, idx) => {
      const duration = Number(cell?.duration ?? cell?.time ?? cell?.value);
      const distance = Number(cell?.distance ?? cell?.meters ?? cell?.dist);
      if (Number.isFinite(duration) && Number.isFinite(distance)) {
        out.push({
          idx,
          routeDistanceMeters: distance,
          routeDurationSeconds: duration,
        });
      }
    });
    return out;
  } catch (error) {
    appendLog(`Matrix call failed: ${error.message}`);
    return [];
  }
}

export async function getRouteMetrics(callGrab, city, place, hour, appendLog) {
  try {
    const departureIso = buildDepartureTime(hour);
    const payload = await callGrab("/api/v1/maps/eta/v1/direction", {
      coordinates: [
        `${city.center[0]},${city.center[1]}`,
        `${place.lng},${place.lat}`,
      ],
      profile: city.profile,
      overview: "full",
      departure_time: departureIso,
    });
    const route = payload?.routes?.[0];
    if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
      return null;
    }
    return {
      routeDistanceMeters: route.distance,
      routeDurationSeconds: route.duration,
    };
  } catch (error) {
    appendLog(`Ranking route miss for ${place.name}: ${error.message}`);
    return null;
  }
}
