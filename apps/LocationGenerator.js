/**
 * GrabMaps Valid Location Generator
 * Ensures orders spawn within business districts, not in the ocean.
 */
class LocationGenerator {
  constructor(cityConfig) {
    this.config = cityConfig;
  }

  normalizeBounds(bounds) {
    const minLat = Math.min(bounds.minLat, bounds.maxLat);
    const maxLat = Math.max(bounds.minLat, bounds.maxLat);
    const minLng = Math.min(bounds.minLng, bounds.maxLng);
    const maxLng = Math.max(bounds.minLng, bounds.maxLng);
    return { minLat, maxLat, minLng, maxLng };
  }

  // Generates a point within the defined safe bounds of a city
  getRandomValidPoint(cityName) {
    const city = this.config.cities[cityName];
    if (!city) throw new Error("City not found in registry");
    const bounds = this.normalizeBounds(city.bounds);

    const lat = Math.random() * (bounds.maxLat - bounds.minLat) + bounds.minLat;
    const lng = Math.random() * (bounds.maxLng - bounds.minLng) + bounds.minLng;

    return {
      lat: parseFloat(lat.toFixed(6)),
      lng: parseFloat(lng.toFixed(6)),
    };
  }

  // Creates a 'Cluster' of orders (simulating a busy mall area)
  generateOrderCluster(cityName, count = 5) {
    const city = this.config.cities[cityName];
    if (!city) throw new Error("City not found in registry");
    const center = city.center;
    const bounds = this.normalizeBounds(city.bounds);
    return Array.from({ length: count }, (_, i) => ({
      id: `ORD_CLUSTER_${i}`,
      // Jitter the center slightly (approx 500m)
      lat: Math.min(
        bounds.maxLat,
        Math.max(bounds.minLat, center.lat + (Math.random() - 0.5) * 0.005),
      ),
      lng: Math.min(
        bounds.maxLng,
        Math.max(bounds.minLng, center.lng + (Math.random() - 0.5) * 0.005),
      ),
    }));
  }
}

export default LocationGenerator;
