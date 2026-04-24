import { renderAppSwitcher } from "../lib/app-switcher.js";
import { fetchGrabStyle, getApiKeyFromWindow, fetchGrabJson } from "../lib/grab-api.js";
import { CITY_CONFIG } from "../lib/utils.js";
import { createGrabMap, attachMapResizeOnLoad } from "../lib/map-renderer.js";

renderAppSwitcher("grab-vector");

const MOTORCYCLE_PROFILE = "motorcycle";
const DEMAND_POI_WEIGHTS = {
  mall: 5,
  office: 3,
  school: 2,
  residential: 1.8,
  apartment: 1.6,
};
const GRID_CELL_KM = 1;
const GRID_RADIUS_KM = 5;

const citySelect = document.getElementById("ggpCitySelect");
const brandInput = document.getElementById("ggpBrandInput");
const departureSlider = document.getElementById("ggpDeparture");
const departureLabel = document.getElementById("ggpDepartureLabel");
const loadNetworkBtn = document.getElementById("ggpLoadNetworkBtn");
const computeDemandBtn = document.getElementById("ggpComputeDemandBtn");
const exportBtn = document.getElementById("ggpExportBtn");
const statusEl = document.getElementById("ggpStatus");
const metricNetNew = document.getElementById("ggpMetricNetNew");
const metricCannibalization = document.getElementById("ggpMetricCannibalization");
const metricEta = document.getElementById("ggpMetricEta");
const metricScore = document.getElementById("ggpMetricScore");

const state = {
  map: null,
  apiKey: getApiKeyFromWindow(),
  cityKey: "SGP",
  assets: [],
  assetMarkers: [],
  proposedMarker: null,
  proposedLngLat: null,
  gridCells: [],
  blueOceanCells: new Set(),
  latestScenario: null,
};

departureLabel.textContent = toHourLabel(Number(departureSlider.value));
citySelect.value = state.cityKey;

loadNetworkBtn.addEventListener("click", () => void runNetworkMapping());
computeDemandBtn.addEventListener("click", () => void recomputeDemandAndCoverage());
departureSlider.addEventListener("input", () => {
  departureLabel.textContent = toHourLabel(Number(departureSlider.value));
});
departureSlider.addEventListener("change", () => void recomputeDemandAndCoverage());
citySelect.addEventListener("change", () => void switchCity(citySelect.value));
exportBtn.addEventListener("click", exportPitchDeckSummary);

kickInit();

function kickInit() {
  if (!state.apiKey) {
    setStatus("Missing Grab Maps API key in config.js", true);
    return;
  }
  if (typeof maplibregl !== "undefined") {
    void initializeMap();
    return;
  }
  let attempts = 0;
  const id = window.setInterval(() => {
    attempts += 1;
    if (typeof maplibregl !== "undefined") {
      clearInterval(id);
      void initializeMap();
      return;
    }
    if (attempts > 120) {
      clearInterval(id);
      setStatus("MapLibre failed to load.", true);
    }
  }, 50);
}

async function initializeMap() {
  setStatus("Fetching map style...");
  try {
    const styleResponse = await fetchGrabStyle(state.apiKey);
    if (!styleResponse.ok) {
      throw new Error(`Style fetch failed (${styleResponse.status})`);
    }
    const style = await styleResponse.json();
    const city = CITY_CONFIG[state.cityKey];
    state.map = createGrabMap({
      container: "map",
      style,
      center: city.center,
      zoom: city.zoom,
    });
    attachMapResizeOnLoad(state.map);
    state.map.on("load", () => {
      attachMapEvents();
      ensureSourcesAndLayers();
      setStatus("Ready. Map current assets to begin.");
    });
  } catch (error) {
    setStatus(`Map init failed: ${error.message}`, true);
  }
}

function attachMapEvents() {
  state.map.on("click", (event) => {
    state.proposedLngLat = [event.lngLat.lng, event.lngLat.lat];
    drawProposedMarker();
    if (state.assets.length) {
      void runScenarioPlanner();
    }
  });
}

function ensureSourcesAndLayers() {
  ensureGeoJsonLayer("ggp-blue-ocean", "fill", {
    "fill-color": "#1d4ed8",
    "fill-opacity": 0.2,
  });
  ensureGeoJsonLayer("ggp-delivery-desert", "fill", {
    "fill-color": "#f59e0b",
    "fill-opacity": 0.12,
  });
  ensureGeoJsonLayer("ggp-demand-grid", "fill", {
    "fill-color": ["coalesce", ["get", "color"], "#334155"],
    "fill-opacity": 0.44,
  });
  ensureGeoJsonLayer("ggp-proposed-iso", "fill", {
    "fill-color": "#10b981",
    "fill-opacity": 0.23,
  });
}

function ensureGeoJsonLayer(id, type, paint) {
  if (!state.map.getSource(id)) {
    state.map.addSource(id, {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
  }
  if (!state.map.getLayer(id)) {
    state.map.addLayer({ id, type, source: id, paint });
  }
}

async function switchCity(cityKey) {
  state.cityKey = cityKey in CITY_CONFIG ? cityKey : "SGP";
  const city = CITY_CONFIG[state.cityKey];
  if (state.map) {
    state.map.flyTo({ center: city.center, zoom: city.zoom });
  }
  clearScenarioOutput();
  await recomputeDemandAndCoverage();
}

async function runNetworkMapping() {
  if (!state.map) return;
  const brand = brandInput.value.trim();
  if (!brand) {
    setStatus("Enter a brand name first.", true);
    return;
  }
  setStatus(`Searching all current assets for ${brand}...`);
  const city = CITY_CONFIG[state.cityKey];

  try {
    const assets = await fetchBrandLocations(brand, city);
    state.assets = assets;
    renderAssetMarkers();
    setStatus(`Mapped ${assets.length} current assets. Computing coverage layers...`);
    await recomputeDemandAndCoverage();
  } catch (error) {
    setStatus(`Brand mapping failed: ${error.message}`, true);
  }
}

async function fetchBrandLocations(brand, city) {
  const query = `${brand} ${city.label}`;
  const endpointCandidates = [
    { endpoint: "/api/v1/maps/place/v2/textsearch", params: { query, limit: 50 } },
    { endpoint: "/api/v1/maps/place/v2/search", params: { query, limit: 50 } },
  ];
  for (const candidate of endpointCandidates) {
    try {
      const payload = await callGrab(candidate.endpoint, candidate.params);
      const parsed = parsePlaces(payload);
      if (parsed.length) return parsed;
    } catch {
      // Try next endpoint.
    }
  }

  const [lng, lat] = city.center;
  const payload = await callGrab("/api/v1/maps/place/v2/nearby", {
    location: `${lat},${lng}`,
    radius: 7,
    limit: 100,
    rankBy: "distance",
    language: "en",
  });
  const all = parsePlaces(payload);
  const k = brand.toLowerCase();
  return all.filter((item) => item.name.toLowerCase().includes(k)).slice(0, 40);
}

async function recomputeDemandAndCoverage() {
  if (!state.map || !state.assets.length) return;
  const city = CITY_CONFIG[state.cityKey];
  const departureHour = Number(departureSlider.value);
  const departureTime = buildDepartureTimeForHour(departureHour);
  setStatus("Running motorcycle matrix for network coverage...");

  const grid = generateGrid(city.center, GRID_RADIUS_KM, GRID_CELL_KM);
  const matrixPoints = grid.map((cell) => `${cell.lng},${cell.lat}`);
  const sources = state.assets.map((asset) => `${asset.lng},${asset.lat}`);
  const matrix = await callGrab("/api/v1/maps/eta/v1/matrix", {
    sources,
    destinations: matrixPoints,
    profile: MOTORCYCLE_PROFILE,
    departure_time: departureTime,
  });

  const durations = parseMatrixDurations(matrix, sources.length, matrixPoints.length);
  const blueOceanCells = new Set();
  for (let col = 0; col < matrixPoints.length; col += 1) {
    const minSec = getMinDurationToDestination(durations, col);
    if (Number.isFinite(minSec) && minSec <= 10 * 60) {
      blueOceanCells.add(grid[col].id);
    }
    grid[col].nearestSec = minSec;
  }
  state.gridCells = await computeDemandWeights(grid);
  state.blueOceanCells = blueOceanCells;

  renderBlueOcean();
  renderDemandLayer();
  const stress = await computeTrafficStress(blueOceanCells, grid);
  setStatus(
    `Coverage + demand layers updated. Reach shrinkage vs 12:00 baseline = ${stress.toFixed(1)}%.`,
  );

  if (state.proposedLngLat) {
    await runScenarioPlanner();
  }
}

async function computeDemandWeights(cells) {
  const out = [];
  const batchSize = 8;
  for (let i = 0; i < cells.length; i += batchSize) {
    const batch = cells.slice(i, i + batchSize);
    const weighted = await Promise.all(
      batch.map(async (cell) => {
        const payload = await callGrab("/api/v1/maps/place/v2/nearby", {
          location: `${cell.lat},${cell.lng}`,
          radius: 0.7,
          limit: 40,
          rankBy: "distance",
          language: "en",
        });
        const points = parsePlaces(payload);
        let weight = 0;
        for (const poi of points) {
          const hay = `${poi.name} ${poi.category}`.toLowerCase();
          if (hay.includes("mall")) weight += DEMAND_POI_WEIGHTS.mall;
          else if (hay.includes("office") || hay.includes("tower")) weight += DEMAND_POI_WEIGHTS.office;
          else if (hay.includes("school") || hay.includes("college") || hay.includes("university"))
            weight += DEMAND_POI_WEIGHTS.school;
          else if (hay.includes("residential") || hay.includes("apartment") || hay.includes("condo"))
            weight += DEMAND_POI_WEIGHTS.residential;
          else weight += 0.6;
        }
        return { ...cell, demandWeight: Number(weight.toFixed(2)) };
      }),
    );
    out.push(...weighted);
  }
  return out;
}

async function computeTrafficStress(currentBlueOceanCells, grid) {
  const sources = state.assets.map((asset) => `${asset.lng},${asset.lat}`);
  const destinations = grid.map((cell) => `${cell.lng},${cell.lat}`);
  const baseline = await callGrab("/api/v1/maps/eta/v1/matrix", {
    sources,
    destinations,
    profile: MOTORCYCLE_PROFILE,
    departure_time: buildDepartureTimeForHour(12),
  });
  const baselineRows = parseMatrixDurations(baseline, sources.length, destinations.length);
  let baselineCovered = 0;
  for (let col = 0; col < destinations.length; col += 1) {
    const minSec = getMinDurationToDestination(baselineRows, col);
    if (Number.isFinite(minSec) && minSec <= 10 * 60) baselineCovered += 1;
  }
  if (!baselineCovered) return 0;
  const currentCovered = currentBlueOceanCells.size;
  return ((baselineCovered - currentCovered) / baselineCovered) * 100;
}

async function runScenarioPlanner() {
  if (!state.proposedLngLat || !state.gridCells.length) return;
  const departureHour = Number(departureSlider.value);
  const departureTime = buildDepartureTimeForHour(departureHour);
  const [lng, lat] = state.proposedLngLat;

  const payload = await callGrab("/api/v1/maps/eta/v1/matrix", {
    sources: `${lng},${lat}`,
    destinations: state.gridCells.map((c) => `${c.lng},${c.lat}`),
    profile: MOTORCYCLE_PROFILE,
    departure_time: departureTime,
  });
  const durations = parseMatrixDurations(payload, 1, state.gridCells.length);
  const row = durations[0] || [];
  const newCoverage = new Set();

  for (let idx = 0; idx < row.length; idx += 1) {
    if (Number.isFinite(row[idx]) && row[idx] <= 10 * 60) {
      newCoverage.add(state.gridCells[idx].id);
    }
  }

  const overlapCount = [...newCoverage].filter((id) => state.blueOceanCells.has(id)).length;
  const totalNewArea = newCoverage.size;
  const netNewArea = totalNewArea - overlapCount;
  const score = totalNewArea > 0 ? netNewArea / totalNewArea : 0;
  const netDemandWeight = state.gridCells
    .filter((cell) => newCoverage.has(cell.id) && !state.blueOceanCells.has(cell.id))
    .reduce((sum, cell) => sum + cell.demandWeight, 0);

  const etaReduction = estimateEtaImprovement(row);
  const cannibalPct = totalNewArea ? (overlapCount / totalNewArea) * 100 : 0;
  state.latestScenario = {
    netDemandWeight,
    cannibalPct,
    etaReduction,
    score,
    newCoverage,
  };

  renderProposedIsochrone(newCoverage);
  renderScenarioMetrics();
}

function estimateEtaImprovement(proposedDurations) {
  let totalBefore = 0;
  let totalAfter = 0;
  let count = 0;
  for (let i = 0; i < state.gridCells.length; i += 1) {
    const before = state.gridCells[i].nearestSec;
    const after = Math.min(before, proposedDurations[i] || Number.POSITIVE_INFINITY);
    if (Number.isFinite(before) && Number.isFinite(after)) {
      totalBefore += before;
      totalAfter += after;
      count += 1;
    }
  }
  if (!count) return 0;
  return (totalBefore - totalAfter) / 60 / count;
}

function renderScenarioMetrics() {
  if (!state.latestScenario) {
    clearScenarioOutput();
    return;
  }
  const { netDemandWeight, cannibalPct, etaReduction, score } = state.latestScenario;
  metricNetNew.textContent = `Net Households Reached: ~${Math.round(netDemandWeight * 16).toLocaleString()}`;
  metricCannibalization.textContent = `Cannibalization Risk: ${classifyCannibalization(cannibalPct)} (${cannibalPct.toFixed(1)}%)`;
  metricEta.textContent = `ETA Improvement: ${etaReduction.toFixed(2)} min average`;
  metricScore.textContent = `Site Score: ${score.toFixed(2)} (higher is better)`;
}

function clearScenarioOutput() {
  metricNetNew.textContent = "Net Households Reached: -";
  metricCannibalization.textContent = "Cannibalization Risk: -";
  metricEta.textContent = "ETA Improvement: -";
  metricScore.textContent = "Site Score: -";
}

function classifyCannibalization(percent) {
  if (percent < 20) return "Low";
  if (percent < 45) return "Medium";
  return "High";
}

function renderAssetMarkers() {
  state.assetMarkers.forEach((marker) => marker.remove());
  state.assetMarkers = [];
  for (const asset of state.assets) {
    const marker = new maplibregl.Marker({ color: "#3b82f6" })
      .setLngLat([asset.lng, asset.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>Current Asset</strong><br>${asset.name}`))
      .addTo(state.map);
    state.assetMarkers.push(marker);
  }
}

function drawProposedMarker() {
  if (!state.proposedLngLat) return;
  if (state.proposedMarker) state.proposedMarker.remove();
  state.proposedMarker = new maplibregl.Marker({ color: "#10b981", draggable: true })
    .setLngLat(state.proposedLngLat)
    .setPopup(new maplibregl.Popup({ offset: 12 }).setText("Proposed Site"))
    .addTo(state.map);
  state.proposedMarker.on("dragend", () => {
    const p = state.proposedMarker.getLngLat();
    state.proposedLngLat = [p.lng, p.lat];
    if (state.assets.length) {
      void runScenarioPlanner();
    }
  });
}

function renderBlueOcean() {
  const blueFeatures = state.gridCells
    .filter((cell) => state.blueOceanCells.has(cell.id))
    .map((cell) => toCellPolygonFeature(cell));
  const desertFeatures = state.gridCells
    .filter((cell) => !state.blueOceanCells.has(cell.id))
    .map((cell) => toCellPolygonFeature(cell));
  setLayerData("ggp-blue-ocean", featureCollection(blueFeatures));
  setLayerData("ggp-delivery-desert", featureCollection(desertFeatures));
}

function renderDemandLayer() {
  const demandValues = state.gridCells.map((cell) => cell.demandWeight);
  const maxDemand = Math.max(...demandValues, 1);
  const features = state.gridCells.map((cell) => {
    const demandRatio = cell.demandWeight / maxDemand;
    const travelRatio = Math.min((cell.nearestSec || 0) / (20 * 60), 1);
    const color = bivariateColor(travelRatio, demandRatio);
    return toCellPolygonFeature({ ...cell, color });
  });
  setLayerData("ggp-demand-grid", featureCollection(features));
}

function renderProposedIsochrone(coveredIds) {
  const features = state.gridCells
    .filter((cell) => coveredIds.has(cell.id))
    .map((cell) => toCellPolygonFeature(cell));
  setLayerData("ggp-proposed-iso", featureCollection(features));
}

function setLayerData(id, data) {
  const source = state.map.getSource(id);
  if (source) source.setData(data);
}

function bivariateColor(travelRatio, demandRatio) {
  if (travelRatio < 0.4 && demandRatio < 0.4) return "#1e293b";
  if (travelRatio >= 0.4 && demandRatio < 0.5) return "#7c2d12";
  if (travelRatio < 0.45 && demandRatio >= 0.5) return "#4338ca";
  return "#22c55e";
}

function toCellPolygonFeature(cell) {
  const halfLat = (GRID_CELL_KM / 2) / 111;
  const halfLng = (GRID_CELL_KM / 2) / (111 * Math.cos((cell.lat * Math.PI) / 180));
  const ring = [
    [cell.lng - halfLng, cell.lat - halfLat],
    [cell.lng + halfLng, cell.lat - halfLat],
    [cell.lng + halfLng, cell.lat + halfLat],
    [cell.lng - halfLng, cell.lat + halfLat],
    [cell.lng - halfLng, cell.lat - halfLat],
  ];
  return {
    type: "Feature",
    properties: {
      id: cell.id,
      demandWeight: cell.demandWeight || 0,
      nearestSec: cell.nearestSec || null,
      color: cell.color || null,
    },
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

function generateGrid(center, radiusKm, cellKm) {
  const [centerLng, centerLat] = center;
  const latStep = cellKm / 111;
  const lngStep = cellKm / (111 * Math.cos((centerLat * Math.PI) / 180));
  const latCount = Math.floor((radiusKm * 2) / cellKm);
  const lngCount = Math.floor((radiusKm * 2) / cellKm);
  const startLat = centerLat - (latCount / 2) * latStep;
  const startLng = centerLng - (lngCount / 2) * lngStep;
  const cells = [];
  let id = 0;
  for (let i = 0; i <= latCount; i += 1) {
    for (let j = 0; j <= lngCount; j += 1) {
      cells.push({
        id: `cell-${id}`,
        lat: startLat + i * latStep,
        lng: startLng + j * lngStep,
      });
      id += 1;
    }
  }
  return cells;
}

function parseMatrixDurations(payload, sourceCount, destinationCount) {
  const rows = payload?.rows || payload?.matrix || payload?.durations || [];
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (let s = 0; s < sourceCount; s += 1) {
    const row = Array.isArray(rows[s]) ? rows[s] : [];
    const parsedRow = [];
    for (let d = 0; d < destinationCount; d += 1) {
      const cell = row[d];
      const sec = Number(cell?.duration ?? cell?.time ?? cell?.value);
      parsedRow.push(Number.isFinite(sec) ? sec : Number.POSITIVE_INFINITY);
    }
    out.push(parsedRow);
  }
  return out;
}

function getMinDurationToDestination(matrixRows, destinationIndex) {
  let min = Number.POSITIVE_INFINITY;
  for (const row of matrixRows) {
    if (row[destinationIndex] < min) min = row[destinationIndex];
  }
  return min;
}

function parsePlaces(payload) {
  const buckets = [payload?.data, payload?.results, payload?.places, payload?.pois, payload?.items].filter(
    Array.isArray,
  );
  const source = buckets[0] || [];
  const parsed = source.map(parsePlace).filter(Boolean);
  if (parsed.length) return uniquePlaces(parsed);
  const fallback = source
    .flatMap((entry) => [entry, ...(Array.isArray(entry?.items) ? entry.items : [])])
    .map(parsePlace)
    .filter(Boolean);
  return uniquePlaces(fallback);
}

function parsePlace(item) {
  const name = item.name || item.displayName || item.poiName || "Unnamed";
  const category = item.category || item.primaryCategory || item.type || "";
  const addr = item.address || item.formattedAddress || "";
  let lat;
  let lng;
  if (typeof item.lat === "number" && typeof item.lng === "number") {
    lat = item.lat;
    lng = item.lng;
  } else if (item.location && typeof item.location.lat === "number") {
    lat = item.location.lat;
    lng = item.location.lng;
  } else if (item.location && typeof item.location.latitude === "number") {
    lat = item.location.latitude;
    lng = item.location.longitude;
  } else if (Array.isArray(item?.location?.coordinates) && item.location.coordinates.length >= 2) {
    lng = Number(item.location.coordinates[0]);
    lat = Number(item.location.coordinates[1]);
  } else if (typeof item.location === "string" && item.location.includes(",")) {
    const [a, b] = item.location.split(",").map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      lat = Math.abs(a) <= 90 ? a : b;
      lng = Math.abs(a) <= 90 ? b : a;
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name, category, address: addr, lat, lng };
}

function uniquePlaces(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.name.toLowerCase()}|${item.lat.toFixed(6)}|${item.lng.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function callGrab(endpoint, params) {
  return fetchGrabJson(state.apiKey, endpoint, params, fetch);
}

function toHourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function buildDepartureTimeForHour(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

function emptyFeatureCollection() {
  return featureCollection([]);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#ffd2d7" : "#c9cde4";
}

function exportPitchDeckSummary() {
  if (!state.latestScenario || !state.proposedLngLat) {
    setStatus("Run a scenario by dropping a pin first.", true);
    return;
  }
  const [lng, lat] = state.proposedLngLat;
  const netCustomers = Math.round(state.latestScenario.netDemandWeight * 16).toLocaleString();
  const summary = [
    "GrabVector Site Card",
    `Brand: ${brandInput.value.trim() || "N/A"}`,
    `Coordinate: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    `Net New Customers: ${netCustomers}`,
    `Cannibalization: ${state.latestScenario.cannibalPct.toFixed(1)}%`,
    `ETA Improvement: ${state.latestScenario.etaReduction.toFixed(2)} min`,
    `Site Score: ${state.latestScenario.score.toFixed(2)}`,
    `Departure Time Tested: ${toHourLabel(Number(departureSlider.value))}`,
    "Profile: MOTORCYCLE only",
  ].join("\n");
  window.navigator.clipboard
    .writeText(summary)
    .then(() => setStatus("Pitch deck summary copied to clipboard."))
    .catch(() => setStatus("Unable to access clipboard. Copy manually from console output."));
  console.log(summary);
}
