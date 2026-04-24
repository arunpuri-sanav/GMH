export const DEFAULT_CITY = "SGP";

export const CITY_CONFIG = {
  SGP: {
    label: "Singapore",
    country: "SGP",
    profile: "driving",
    center: [103.78711, 1.29945],
    zoom: 13.2,
  },
  JAKARTA: {
    label: "Jakarta",
    country: "IDN",
    profile: "motorcycle",
    center: [106.8272, -6.1754],
    zoom: 12.4,
  },
  BANGKOK: {
    label: "Bangkok",
    country: "THA",
    profile: "motorcycle",
    center: [100.5347, 13.7466],
    zoom: 12.4,
  },
};

export function formatHourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function buildDepartureTime(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function getTimeWeight(hour, profile) {
  const isPeak = (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 21);
  if (profile === "motorcycle") return isPeak ? 2.3 : 1.6;
  return isPeak ? 3.3 : 2.1;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getPlaceEmoji(place) {
  const hay = `${place.name || ""} ${place.category || ""}`.toLowerCase();
  if (hay.includes("coffee") || hay.includes("luckin") || hay.includes("cafe")) return "☕";
  if (hay.includes("chagee") || hay.includes("tea") || hay.includes("bubble")) return "🧋";
  if (hay.includes("grab")) return "🚕";
  if (hay.includes("mall") || hay.includes("shop") || hay.includes("store")) return "🛍️";
  if (hay.includes("restaurant") || hay.includes("food")) return "🍽️";
  return "📍";
}

export function getPlaceIconUrl(place) {
  const hay = `${place.name || ""} ${place.category || ""}`.toLowerCase();
  if (hay.includes("luckin")) return "https://logo.clearbit.com/luckincoffee.com";
  if (hay.includes("chagee")) return "https://logo.clearbit.com/chagee.com";
  if (hay.includes("grab")) return "https://logo.clearbit.com/grab.com";
  return "";
}

export function parseFeatureCandidate(item) {
  const name =
    item.name ||
    item.displayName ||
    item.poiName ||
    item.address ||
    item.formattedAddress ||
    "Unnamed place";

  let lat;
  let lng;
  if (typeof item.lat === "number" && typeof item.lng === "number") {
    lat = item.lat;
    lng = item.lng;
  } else if (typeof item.latitude === "number" && typeof item.longitude === "number") {
    lat = item.latitude;
    lng = item.longitude;
  } else if (item.location && typeof item.location.lat === "number") {
    lat = item.location.lat;
    lng = item.location.lng;
  } else if (item.location && typeof item.location.latitude === "number") {
    lat = item.location.latitude;
    lng = item.location.longitude;
  } else if (
    item.location &&
    Array.isArray(item.location.coordinates) &&
    item.location.coordinates.length >= 2
  ) {
    lng = Number(item.location.coordinates[0]);
    lat = Number(item.location.coordinates[1]);
  } else if (
    item.geometry &&
    item.geometry.location &&
    typeof item.geometry.location.lat === "number"
  ) {
    lat = item.geometry.location.lat;
    lng = item.geometry.location.lng;
  } else if (
    item.geometry &&
    Array.isArray(item.geometry.coordinates) &&
    item.geometry.coordinates.length >= 2
  ) {
    lng = Number(item.geometry.coordinates[0]);
    lat = Number(item.geometry.coordinates[1]);
  } else if (typeof item.location === "string" && item.location.includes(",")) {
    const [first, second] = item.location.split(",");
    const a = Number(first);
    const b = Number(second);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
        lat = a;
        lng = b;
      } else {
        lng = a;
        lat = b;
      }
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const address =
    item.address ||
    item.formattedAddress ||
    item.displayAddress ||
    item.fullAddress ||
    "";
  const category =
    item.category || item.primaryCategory || item.type || item.placeType || "";
  const id = item.id || item.placeId || item.poiId || "";
  return { name, lat, lng, address, category, id, raw: item };
}

export function getResultItems(payload) {
  const buckets = [
    payload?.data,
    payload?.results,
    payload?.places,
    payload?.pois,
    payload?.items,
  ].filter(Array.isArray);
  const source = buckets[0] || [];
  const parsed = source.map(parseFeatureCandidate).filter(Boolean);
  if (parsed.length) return parsed;

  const flattened = source
    .flatMap((entry) => [entry, ...(Array.isArray(entry?.items) ? entry.items : [])])
    .map(parseFeatureCandidate)
    .filter(Boolean);
  return flattened;
}

export function filterPlacesByKeyword(items, keyword) {
  const k = (keyword || "").trim().toLowerCase();
  if (!k) return items;
  return items.filter((item) => {
    const hay = `${item.name || ""} ${item.address || ""} ${item.category || ""}`.toLowerCase();
    return hay.includes(k);
  });
}

export function flattenForList(value, prefix = "") {
  if (value === null || value === undefined) return [`${prefix || "value"}: ${String(value)}`];
  if (typeof value !== "object") return [`${prefix || "value"}: ${String(value)}`];
  if (Array.isArray(value)) {
    const out = [`${prefix || "array"}: [${value.length}]`];
    value.slice(0, 10).forEach((item, idx) => {
      out.push(...flattenForList(item, `${prefix}[${idx}]`));
    });
    return out;
  }
  const out = [];
  Object.entries(value).forEach(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) out.push(...flattenForList(v, p));
    else out.push(`${p}: ${String(v)}`);
  });
  return out;
}
