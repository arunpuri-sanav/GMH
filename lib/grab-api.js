/**
 * Grab Maps HTTP helpers — no UI. Use with your own fetch wrapper for logging/auth.
 */

export const GRAB_MAPS_ORIGIN = "https://maps.grab.com";

export function getApiKeyFromWindow() {
  const k =
    typeof window !== "undefined" &&
    window.APP_CONFIG &&
    typeof window.APP_CONFIG.GRAB_MAPS_API_KEY === "string"
      ? window.APP_CONFIG.GRAB_MAPS_API_KEY.trim()
      : "";
  return k;
}

export function bearerHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * @param {string} endpoint Path starting with `/`, e.g. `/api/v1/maps/place/v2/nearby`
 * @param {Record<string, string|number|Array<string|number>>} [params]
 */
export function buildGrabUrl(endpoint, params = {}) {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${GRAB_MAPS_ORIGIN}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

/**
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} fetchFn
 */
export async function fetchGrabStyle(apiKey, fetchFn = fetch) {
  const url = `${GRAB_MAPS_ORIGIN}/api/style.json`;
  return fetchFn(url, {
    method: "GET",
    headers: bearerHeaders(apiKey),
  });
}

/**
 * Fetch style variants for day/night and optional traffic intent.
 * If the backend ignores unknown query params, it still returns default style.
 */
export async function fetchGrabStyleVariant(
  apiKey,
  { theme = "day", traffic = false } = {},
  fetchFn = fetch,
) {
  const url = buildGrabUrl("/api/style.json", {
    theme,
    traffic: traffic ? "true" : "",
  }).toString();
  return fetchFn(url, {
    method: "GET",
    headers: bearerHeaders(apiKey),
  });
}

/**
 * GET JSON from maps.grab.com; throws if response is not ok.
 * @param {(input: RequestInfo, init?: RequestInit) => Promise<Response>} fetchFn
 */
export async function fetchGrabJson(apiKey, endpoint, params, fetchFn = fetch) {
  const url = buildGrabUrl(endpoint, params).toString();
  const response = await fetchFn(url, {
    method: "GET",
    headers: bearerHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(`${endpoint} failed (${response.status})`);
  }
  return response.json();
}

export async function fetchGrabPlacesNearby(
  apiKey,
  { centerLngLat, radiusKm = 5, limit = 50, categories = [], keyword = "", language = "en" },
  fetchFn = fetch,
) {
  const [lng, lat] = centerLngLat;
  return fetchGrabJson(
    apiKey,
    "/api/v1/maps/place/v2/nearby",
    {
      location: `${lat},${lng}`,
      radius: radiusKm,
      limit,
      rankBy: "distance",
      language,
      category: categories,
      keyword,
    },
    fetchFn,
  );
}

export async function fetchGrabMatrix(
  apiKey,
  { sourcesLngLat = [], destinationsLngLat = [], profile = "motorcycle", departureTime },
  fetchFn = fetch,
) {
  return fetchGrabJson(
    apiKey,
    "/api/v1/maps/eta/v1/matrix",
    {
      sources: sourcesLngLat.map(([lng, lat]) => `${lng},${lat}`),
      destinations: destinationsLngLat.map(([lng, lat]) => `${lng},${lat}`),
      profile,
      departure_time: departureTime || "",
    },
    fetchFn,
  );
}

export async function fetchGrabDirections(
  apiKey,
  {
    fromLngLat,
    toLngLat,
    profile = "motorcycle",
    overview = "full",
    avoidTolls = false,
    allowAlleyways = false,
    departureTime = "",
  },
  fetchFn = fetch,
) {
  const [fromLng, fromLat] = fromLngLat;
  const [toLng, toLat] = toLngLat;
  return fetchGrabJson(
    apiKey,
    "/api/v1/maps/eta/v1/direction",
    {
      coordinates: [`${fromLng},${fromLat}`, `${toLng},${toLat}`],
      profile,
      overview,
      departure_time: departureTime,
      avoid: avoidTolls ? "toll" : "",
      alleyway: allowAlleyways ? "true" : "",
    },
    fetchFn,
  );
}

/** @param {[number, number]} centerLngLat */
export function nearbyParamsFromCenter(centerLngLat, { radiusKm, limit, language = "en" } = {}) {
  const [lng, lat] = centerLngLat;
  return {
    location: `${lat},${lng}`,
    radius: radiusKm,
    limit,
    rankBy: "distance",
    language,
  };
}
