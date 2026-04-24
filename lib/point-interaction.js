/**
 * Markers, popups, and center-point affordances (MapLibre).
 * Expects global `maplibregl`.
 */

import { escapeHtml, getPlaceEmoji, getPlaceIconUrl } from "./utils.js";

export function buildPlacePopupHtml(place) {
  const emoji = getPlaceEmoji(place);
  const iconUrl = getPlaceIconUrl(place);
  const iconHtml = iconUrl
    ? `<img class="poi-popup-icon" src="${escapeHtml(iconUrl)}" alt="" onerror="this.style.display='none'" />`
    : "";

  const parts = [];
  parts.push(
    `<div class="poi-popup-header">${iconHtml}<div class="poi-popup-title">${emoji} ${escapeHtml(
      place.name || "Unnamed place",
    )}</div></div>`,
  );
  if (place.address) {
    parts.push(`<div class="poi-popup-line">${escapeHtml(place.address)}</div>`);
  }
  if (place.category) {
    parts.push(`<div class="poi-popup-line">Category: ${escapeHtml(String(place.category))}</div>`);
  }
  if (place.id) {
    parts.push(`<div class="poi-popup-line">ID: ${escapeHtml(String(place.id))}</div>`);
  }
  parts.push(
    `<div class="poi-popup-line">Lat/Lng: ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}</div>`,
  );
  return parts.join("");
}

/**
 * @param {*} map MapLibre map
 * @param {object} place
 * @param {{ color: string, rank: number|null, lngLat?: [number, number], markersOut: unknown[] }} opts
 */
export function addRankOrDotMarker(map, place, opts) {
  const { color, rank, lngLat, markersOut } = opts;
  const markerElement = document.createElement("div");
  markerElement.className = "rank-marker";
  markerElement.style.borderColor = color;
  if (rank !== null) {
    markerElement.style.zIndex = String(1000 - rank);
  }
  markerElement.innerHTML =
    rank !== null ? `<span class="rank-badge">${rank}</span>` : `<span class="rank-dot"></span>`;

  const marker = new maplibregl.Marker({ element: markerElement })
    .setLngLat(lngLat || [place.lng, place.lat])
    .setPopup(new maplibregl.Popup({ offset: 18 }).setHTML(buildPlacePopupHtml(place)))
    .addTo(map);
  markersOut.push(marker);
  return marker;
}

/** @param {unknown[]} markers */
export function removeMarkers(markers) {
  markers.forEach((m) => m.remove());
  markers.length = 0;
}

/** @param {*} map @param {[number, number]} lngLat @param {{ current: unknown }} holder */
export function mountCenterMarker(map, lngLat, cityLabel, holder) {
  if (holder.current) {
    holder.current.remove();
    holder.current = null;
  }
  const centerEl = document.createElement("div");
  centerEl.className = "center-marker";
  centerEl.textContent = "C";
  holder.current = new maplibregl.Marker({ element: centerEl })
    .setLngLat(lngLat)
    .setPopup(
      new maplibregl.Popup({ offset: 14 }).setHTML(
        `<div class="poi-popup-title">Center Point</div><div class="poi-popup-line">${escapeHtml(
          cityLabel,
        )} routing origin</div>`,
      ),
    )
    .addTo(map);
}
