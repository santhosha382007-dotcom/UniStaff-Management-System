/**
 * Haversine formula to calculate great-circle distance between two points in meters
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Validates if employee coordinates fall inside office geofence
 */
export function isWithinGeofence(userLat, userLng, officeLat, officeLng, allowedRadiusMeters) {
  const distance = calculateDistanceMeters(userLat, userLng, officeLat, officeLng);
  return {
    isWithin: distance <= allowedRadiusMeters,
    distanceMeters: distance,
    allowedRadiusMeters
  };
}
