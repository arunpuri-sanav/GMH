import {
  bearerHeaders,
  buildGrabUrl,
  fetchGrabStyle,
  getApiKeyFromWindow,
  nearbyParamsFromCenter,
} from "./lib/grab-api.js";
import { createNetworkLogStore, loggedFetch } from "./lib/network-log.js";
import {
  attachMapResizeOnLoad,
  clearRouteLayer,
  createGrabMap,
  setRouteGeoJson,
} from "./lib/map-renderer.js";
import {
  addRankOrDotMarker,
  mountCenterMarker,
  removeMarkers,
} from "./lib/point-interaction.js";
import { getVisibleCandidates, rankPlacesByRouting } from "./lib/places-ranking.js";
import { renderAppSwitcher } from "./lib/app-switcher.js";
import {
  exportNetworkEntriesAsDownload,
  renderNetworkLogList,
  renderResponsePreviewList,
} from "./lib/ui-network-dock.js";
import {
  CITY_CONFIG,
  DEFAULT_CITY,
  filterPlacesByKeyword,
  formatHourLabel,
  getResultItems,
} from "./lib/utils.js";

renderAppSwitcher("showcase");

const glassPanel = document.getElementById("glassPanel");
const citySelect = document.getElementById("citySelect");
const keywordInput = document.getElementById("keywordInput");
const timeSlider = document.getElementById("timeSlider");
const timeValueLabel = document.getElementById("timeValueLabel");
const searchBtn = document.getElementById("searchBtn");
const nearbyBtn = document.getElementById("nearbyBtn");
const routeBtn = document.getElementById("routeBtn");
const clearBtn = document.getElementById("clearBtn");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const networkDock = document.getElementById("networkDock");
const networkLogEl = document.getElementById("networkLog");
const togglePreviewBtn = document.getElementById("togglePreviewBtn");
const exportNetworkBtn = document.getElementById("exportNetworkBtn");
const responsePreviewEl = document.getElementById("responsePreview");
const dockHeightBtn = document.getElementById("dockHeightBtn");
const dockSideBtn = document.getElementById("dockSideBtn");

let map;
const markers = [];
let selectedTarget = null;
let latestBaseResults = [];
let lastFetchUsesRanking = false;
let rankingDebounceId = null;
const centerMarkerHolder = { current: null };
let dockIsHalf = false;
let dockCollapsedRight = false;
let selectedNetworkId = null;

const networkStore = createNetworkLogStore();
const configApiKey = getApiKeyFromWindow();

function appendNetworkLog(message, detail = null) {
  networkStore.append(message, detail);
}

const logAdapter = {
  append: appendNetworkLog,
  onResponsePreview: (title, payload) => {
    renderResponsePreviewList(responsePreviewEl, title, payload);
  },
};

function renderDock() {
  const entries = networkStore.getEntries();
  if (!entries.some((e) => e.id === selectedNetworkId)) {
    selectedNetworkId = entries.at(-1)?.id ?? null;
  }
  renderNetworkLogList(networkLogEl, entries, {
    selectedId: selectedNetworkId,
    onSelect: (entry) => {
      selectedNetworkId = entry.id;
      renderDock();
      if (entry.detail) {
        renderResponsePreviewList(responsePreviewEl, entry.detail.title, entry.detail.payload);
      } else {
        responsePreviewEl.textContent = entry.title;
      }
    },
    responsePreviewEl,
  });
}

networkStore.subscribe(renderDock);
renderDock();

citySelect.value = DEFAULT_CITY;
timeValueLabel.textContent = formatHourLabel(Number(timeSlider.value));

setControlState(false);
renderResults([]);

searchBtn.addEventListener("click", runKeywordSearch);
nearbyBtn.addEventListener("click", runNearbySearch);
routeBtn.addEventListener("click", drawRouteToSelected);
clearBtn.addEventListener("click", clearShowcaseLayers);
citySelect.addEventListener("change", focusSelectedCity);
timeSlider.addEventListener("input", onTimeSliderInput);
dockHeightBtn.addEventListener("click", toggleDockHeight);
dockSideBtn.addEventListener("click", toggleDockSideCollapse);
togglePreviewBtn.addEventListener("click", toggleResponsePreview);
exportNetworkBtn.addEventListener("click", () =>
  exportNetworkEntriesAsDownload(networkStore.getEntries(), appendNetworkLog),
);

glassPanel.addEventListener("mouseenter", () => glassPanel.classList.add("is-focused"));
glassPanel.addEventListener("mouseleave", () => {
  if (!glassPanel.matches(":focus-within")) glassPanel.classList.remove("is-focused");
});
glassPanel.addEventListener("focusin", () => glassPanel.classList.add("is-focused"));
glassPanel.addEventListener("focusout", () => {
  setTimeout(() => {
    if (!glassPanel.matches(":focus-within")) glassPanel.classList.remove("is-focused");
  }, 0);
});

glassPanel.addEventListener("mouseenter", () => bringToFront("panel"));
glassPanel.addEventListener("focusin", () => bringToFront("panel"));
networkDock.addEventListener("mouseenter", () => bringToFront("dock"));
networkDock.addEventListener("focusin", () => bringToFront("dock"));
applyDockState();

function kickInitializeMap() {
  if (typeof maplibregl !== "undefined") {
    void initializeMap();
    return;
  }
  setStatus("Waiting for MapLibre…", false);
  let tries = 0;
  const id = window.setInterval(() => {
    tries += 1;
    if (typeof maplibregl !== "undefined") {
      window.clearInterval(id);
      void initializeMap();
    } else if (tries > 120) {
      window.clearInterval(id);
      setStatus("MapLibre failed to load. Check the script URL or network.", true);
    }
  }, 50);
}

function startMapAfterLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(kickInitializeMap);
  });
}

if (document.readyState === "complete") {
  startMapAfterLayout();
} else {
  window.addEventListener("load", startMapAfterLayout, { once: true });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#ffd2d7" : "#c9cde4";
}

function setControlState(enabled) {
  for (const button of [searchBtn, nearbyBtn, routeBtn, clearBtn]) {
    button.disabled = !enabled;
    button.style.opacity = enabled ? "1" : "0.55";
  }
}

function getSelectedCityConfig() {
  return CITY_CONFIG[citySelect.value] || CITY_CONFIG[DEFAULT_CITY];
}

function onTimeSliderInput() {
  const hour = Number(timeSlider.value);
  timeValueLabel.textContent = formatHourLabel(hour);
  if (!lastFetchUsesRanking || !latestBaseResults.length || !map) return;

  if (rankingDebounceId) {
    clearTimeout(rankingDebounceId);
  }
  rankingDebounceId = setTimeout(async () => {
    rankingDebounceId = null;
    await rerankLatestResults("time-slider");
  }, 700);
}

async function callGrab(endpoint, params) {
  const apiKey = configApiKey;
  if (!apiKey) {
    throw new Error("Missing API key in config.js");
  }
  const url = buildGrabUrl(endpoint, params).toString();
  const response = await loggedFetch(
    url,
    { method: "GET", headers: bearerHeaders(apiKey) },
    logAdapter,
  );
  if (!response.ok) {
    throw new Error(`${endpoint} failed (${response.status})`);
  }
  return response.json();
}

async function initializeMap() {
  const apiKey = configApiKey;
  if (!apiKey) {
    setStatus("Missing API key in config.js (APP_CONFIG.GRAB_MAPS_API_KEY).", true);
    return;
  }
  setStatus("Fetching map style...");

  try {
    const response = await fetchGrabStyle(apiKey, (url, init) =>
      loggedFetch(url, init, logAdapter),
    );
    if (!response.ok) {
      throw new Error(`Style fetch failed: ${response.status}`);
    }
    const style = await response.json();

    if (map) {
      if (centerMarkerHolder.current) {
        centerMarkerHolder.current.remove();
        centerMarkerHolder.current = null;
      }
      map.remove();
      removeMarkers(markers);
      selectedTarget = null;
    }

    const city = getSelectedCityConfig();
    map = createGrabMap({
      container: "map",
      style,
      center: city.center,
      zoom: city.zoom,
    });
    attachMapResizeOnLoad(map);
    map.on("load", () => {
      mountCenterMarker(map, city.center, city.label, centerMarkerHolder);
      setControlState(true);
      setStatus(`Map initialized for ${city.label}.`);
    });
    map.on("error", (error) => {
      console.error(error);
      setStatus("Map rendering error. Check console and API permissions.", true);
    });
  } catch (error) {
    console.error(error);
    setStatus("Unable to initialize map. Verify API key and network.", true);
  }
}

function focusSelectedCity() {
  if (!map) return;
  const city = getSelectedCityConfig();
  map.flyTo({ center: city.center, zoom: city.zoom, duration: 900 });
  mountCenterMarker(map, city.center, city.label, centerMarkerHolder);
  setStatus(
    `${city.label} selected. Route profile: ${
      city.profile === "driving" ? "Car" : "Motorcycle"
    }.`,
  );
}

async function fetchPlaceNearby(city, { radiusKm, limit }) {
  return callGrab(
    "/api/v1/maps/place/v2/nearby",
    nearbyParamsFromCenter(city.center, { radiusKm, limit }),
  );
}

function renderResults(items) {
  resultsEl.innerHTML = "";
  if (!items.length) {
    resultsEl.textContent = "No results yet.";
    return;
  }
  items.slice(0, 5).forEach((item, index) => {
    const btn = document.createElement("button");
    btn.className = "result-item";
    const distanceText = Number.isFinite(item.routeDistanceMeters)
      ? `${(item.routeDistanceMeters / 1000).toFixed(2)} km`
      : "n/a";
    const etaText = Number.isFinite(item.routeDurationSeconds)
      ? `${Math.round(item.routeDurationSeconds / 60)} min`
      : "n/a";
    btn.textContent = `#${index + 1} ${item.name} - ${distanceText}, ${etaText}`;
    btn.addEventListener("click", () => {
      selectedTarget = item;
      setStatus(`Selected: #${index + 1} ${item.name}`);
    });
    resultsEl.appendChild(btn);
  });
}

function renderResultsUnranked(items) {
  resultsEl.innerHTML = "";
  if (!items.length) {
    resultsEl.textContent = "No results yet.";
    return;
  }
  items.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.className = "result-item";
    btn.textContent = `#${index + 1} ${item.name} (nearby API order)`;
    btn.addEventListener("click", () => {
      selectedTarget = item;
      setStatus(`Selected: #${index + 1} ${item.name}`);
    });
    resultsEl.appendChild(btn);
  });
}

function logApiSummary(label, payload, renderedCount) {
  const ok = payload?.success !== false && payload?.status !== "error";
  const statusText = payload?.status || payload?.message || (ok ? "success" : "failed");
  appendNetworkLog(
    `${label} summary: ${statusText}; rendered=${renderedCount}; keys=${Object.keys(
      payload || {},
    ).join(",")}`,
  );
}

async function runKeywordSearch() {
  if (!map) return;
  const city = getSelectedCityConfig();
  const keyword = keywordInput.value.trim() || "Luckin";
  lastFetchUsesRanking = true;
  setStatus(`Fetching nearby places, filtering "${keyword}", then ranking…`);
  try {
    const payload = await fetchPlaceNearby(city, { radiusKm: 2, limit: 10 });
    let items = getResultItems(payload);
    items = filterPlacesByKeyword(items, keyword);
    logApiSummary("Place Nearby (rank seed)", payload, items.length);
    if (!items.length) {
      setStatus(
        "No mappable nearby results matched that keyword within ~2 km of center. Try another keyword or use Nearby (no rank).",
        true,
      );
      latestBaseResults = [];
      return;
    }
    latestBaseResults = items.slice(0, 10);
    await rerankLatestResults("search");
  } catch (error) {
    console.error(error);
    appendNetworkLog(`Place Nearby (ranked) failed: ${error.message}`);
    setStatus("Nearby + rank failed. Check key/permissions.", true);
  }
}

async function runNearbySearch() {
  if (!map) return;
  const city = getSelectedCityConfig();
  lastFetchUsesRanking = false;
  latestBaseResults = [];
  setStatus(`Fetching nearby places (${city.label}, 1 km, no routing rank)…`);
  try {
    const payload = await fetchPlaceNearby(city, { radiusKm: 1, limit: 10 });
    const items = getResultItems(payload);
    logApiSummary("Place Nearby (no ranking)", payload, items.length);
    if (!items.length) {
      setStatus("Nearby returned no mappable results.", true);
      renderResultsUnranked([]);
      return;
    }
    const visible = getVisibleCandidates(items.slice(0, 10), map);
    if (!visible.length) {
      renderResults([]);
      setStatus("No results in current map view. Pan the map and try again.", true);
      return;
    }
    clearShowcaseLayers(false, false);
    const top = visible.slice(0, 5);
    top.forEach((item) => addRankOrDotMarker(map, item, { color: "#a5d6a7", rank: null, markersOut: markers }));
    renderResultsUnranked(top);
    selectedTarget = top[0];
    setStatus(`Showing ${top.length} nearby place(s) (API distance order, no matrix rank).`);
  } catch (error) {
    console.error(error);
    appendNetworkLog(`Place Nearby (no rank) failed: ${error.message}`);
    setStatus("Nearby search failed. Check key/permissions.", true);
  }
}

async function drawRouteToSelected() {
  if (!map) return;
  if (!selectedTarget) {
    setStatus("Pick a result first via Search or Nearby.", true);
    return;
  }

  const city = getSelectedCityConfig();
  setStatus(`Fetching route (${city.profile}) to ${selectedTarget.name}...`);
  try {
    const payload = await callGrab("/api/v1/maps/eta/v1/direction", {
      coordinates: [
        `${city.center[0]},${city.center[1]}`,
        `${selectedTarget.lng},${selectedTarget.lat}`,
      ],
      profile: city.profile,
      overview: "full",
    });
    const route = payload?.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    const routeCount = Array.isArray(payload?.routes) ? payload.routes.length : 0;
    appendNetworkLog(
      `Directions summary: success, routes=${routeCount}, hasGeometry=${
        Array.isArray(coordinates) && coordinates.length > 0
      }`,
    );
    if (!Array.isArray(coordinates) || !coordinates.length) {
      setStatus("Direction returned without drawable geometry.", true);
      return;
    }

    setRouteGeoJson(map, coordinates);

    const km = route?.distance ? (route.distance / 1000).toFixed(2) : "n/a";
    const mins = route?.duration ? Math.round(route.duration / 60) : "n/a";
    setStatus(`Route ready: ${km} km, ${mins} mins (${city.profile}).`);
  } catch (error) {
    console.error(error);
    appendNetworkLog(`Directions summary: failed (${error.message})`);
    setStatus("Directions request failed. Check key/permissions.", true);
  }
}

function clearShowcaseLayers(updateStatus = true, resetRankingData = true) {
  if (!map) return;
  removeMarkers(markers);
  clearRouteLayer(map);
  selectedTarget = null;
  if (resetRankingData) {
    latestBaseResults = [];
  }

  if (updateStatus) {
    setStatus("Cleared markers and route.");
  }
}

async function rerankLatestResults(reason) {
  if (!latestBaseResults.length) return;
  const city = getSelectedCityConfig();
  const hour = Number(timeSlider.value);
  setStatus(`Ranking places by route closeness for ${formatHourLabel(hour)}...`);

  const visible = getVisibleCandidates(latestBaseResults, map);
  if (!visible.length) {
    renderResults([]);
    setStatus("No results in current map view. Move map and search again.", true);
    return;
  }
  if (visible.length < 5) {
    appendNetworkLog(
      `Visible-area note: only ${visible.length} candidate(s) available in current view.`,
    );
  }

  const ranked = await rankPlacesByRouting(callGrab, visible, city, hour, appendNetworkLog);
  if (!ranked.length) {
    renderResults([]);
    setStatus("No routable results found for ranking.", true);
    return;
  }

  clearShowcaseLayers(false, false);
  const top = ranked.slice(0, 5);
  const coordUseCount = new Map();
  for (let i = top.length - 1; i >= 0; i -= 1) {
    const item = top[i];
    const rank = i + 1;
    const key = `${item.lng.toFixed(6)},${item.lat.toFixed(6)}`;
    const seen = coordUseCount.get(key) || 0;
    coordUseCount.set(key, seen + 1);

    const angle = (Math.PI / 3) * seen;
    const offsetLng = item.lng + Math.cos(angle) * seen * 0.00008;
    const offsetLat = item.lat + Math.sin(angle) * seen * 0.00008;
    addRankOrDotMarker(map, item, {
      color: "#90caf9",
      rank,
      lngLat: [offsetLng, offsetLat],
      markersOut: markers,
    });
  }
  renderResults(top);
  selectedTarget = top[0];
  appendNetworkLog(
    `Ranking summary (${reason}): hour=${formatHourLabel(hour)}, top=${top.length}, best=${top[0].name}`,
  );
  setStatus(
    `Ranked ${top.length}${top.length < 5 ? " (less than 5 in visible area)" : ""} by routing closeness at ${formatHourLabel(hour)}.`,
  );
}

function toggleDockHeight() {
  dockIsHalf = !dockIsHalf;
  applyDockState();
}

function toggleDockSideCollapse() {
  dockCollapsedRight = !dockCollapsedRight;
  applyDockState();
}

function applyDockState() {
  networkDock.classList.toggle("is-half", dockIsHalf);
  networkDock.classList.toggle("is-compact", !dockIsHalf);
  networkDock.classList.toggle("is-collapsed-right", dockCollapsedRight);
  dockHeightBtn.textContent = dockIsHalf ? "⬇" : "⬆";
  dockSideBtn.textContent = dockCollapsedRight ? "⬅" : "➡";
  if (dockIsHalf && !dockCollapsedRight) {
    bringToFront("dock");
  }
}

function bringToFront(target) {
  glassPanel.classList.toggle("is-front", target === "panel");
  networkDock.classList.toggle("is-front", target === "dock");
}

function toggleResponsePreview() {
  const isHidden = responsePreviewEl.classList.toggle("hidden");
  togglePreviewBtn.textContent = isHidden ? "Show Preview" : "Hide Preview";
}
