export interface Point {
  lat: number;
  lng: number;
}

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle ("straight line") distance in km. */
export function distanceKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "~4.5 กม." under 10 km, "~12 กม." above. Always approximate: job sites give districts. */
export function formatKm(km: number): string {
  const n = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `~${n.toLocaleString('en-US')} กม.`;
}

export interface NamedPoint extends Point {
  label: string;
}

/** "บ้าน ~12 กม. · คอนโด ~4.5 กม.", nearest first. */
export function describeDistances(places: NamedPoint[], to: Point): string {
  return places
    .map((p) => ({ label: p.label, km: distanceKm(p, to) }))
    .sort((a, b) => a.km - b.km)
    .map((d) => `${d.label} ${formatKm(d.km)}`)
    .join(' · ');
}

/** Google Maps directions to a point. No origin: the app uses the phone's own location. */
export function directionsUrl(to: Point): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}
