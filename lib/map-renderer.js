/**
 * MapLibre map lifecycle + route line layers.
 * Expects global `maplibregl` (script tag before your module).
 */

export const ROUTE_LAYER_ID = "showcase-route";
export const ROUTE_SOURCE_ID = "showcase-route-source";

/**
 * @param {{ container: string|HTMLElement, style: object, center: [number, number], zoom: number }} opts
 */
export function createGrabMap(opts) {
  const map = new maplibregl.Map({
    container: opts.container,
    style: opts.style,
    center: opts.center,
    zoom: opts.zoom,
    attributionControl: true,
  });
  map.addControl(new maplibregl.NavigationControl(), "bottom-left");
  return map;
}

/** @param {*} map MapLibre Map instance */
export function attachMapResizeOnLoad(map) {
  map.on("load", () => {
    map.resize();
  });
  requestAnimationFrame(() => {
    map.resize();
  });
}

/** @param {*} map @param {number[][]} coordinates [lng, lat][] */
export function setRouteGeoJson(map, coordinates) {
  if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
  if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);

  map.addSource(ROUTE_SOURCE_ID, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates,
      },
    },
  });
  map.addLayer({
    id: ROUTE_LAYER_ID,
    type: "line",
    source: ROUTE_SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: {
      "line-color": "#7c9eff",
      "line-width": 5,
      "line-opacity": 0.9,
    },
  });
}

/** @param {*} map */
export function clearRouteLayer(map) {
  if (map.getLayer(ROUTE_LAYER_ID)) map.removeLayer(ROUTE_LAYER_ID);
  if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
}
