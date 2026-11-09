import { NavigationRoute } from './routing.service';

const earthRadiusMeters = 6_371_000;
export const arrivalRadiusMeters = 35;
export const offRouteThresholdMeters = 50;
export const rerouteCooldownMilliseconds = 30_000;
const maximumArrivalAccuracyMeters = 50;
const maximumRerouteAccuracyMeters = 40;

export interface RoutePosition {
  distanceMeters: number;
  progressMeters: number;
  segmentIndex: number;
}

export function isArrivalPosition(distanceToDestination: number, accuracy: number): boolean {
  return Number.isFinite(distanceToDestination) && distanceToDestination <= arrivalRadiusMeters
    && Number.isFinite(accuracy) && accuracy <= maximumArrivalAccuracyMeters;
}

export function shouldReroute(offRouteDistance: number, accuracy: number, elapsedSinceReroute: number): boolean {
  return Number.isFinite(offRouteDistance) && offRouteDistance > offRouteThresholdMeters
    && Number.isFinite(accuracy) && accuracy <= maximumRerouteAccuracyMeters
    && elapsedSinceReroute >= rerouteCooldownMilliseconds;
}

export function distanceBetween(
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  const safeValue = Math.min(1, Math.max(0, value));
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(safeValue), Math.sqrt(1 - safeValue));
}

export function cumulativeRouteDistances(coordinates: Array<[number, number]>): number[] {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]!;
    const current = coordinates[index]!;
    cumulative.push(cumulative[index - 1]! + distanceBetween(
      { latitude: previous[1], longitude: previous[0] },
      { latitude: current[1], longitude: current[0] },
    ));
  }
  return cumulative;
}

export function nearestRoutePosition(
  point: { latitude: number; longitude: number },
  coordinates: Array<[number, number]>,
  cumulativeDistances: number[],
): RoutePosition {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const metersPerLongitude = earthRadiusMeters * Math.cos(radians(point.latitude)) * Math.PI / 180;
  const metersPerLatitude = earthRadiusMeters * Math.PI / 180;
  let nearest: RoutePosition = { distanceMeters: Number.POSITIVE_INFINITY, progressMeters: 0, segmentIndex: 0 };

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const first = coordinates[index]!;
    const second = coordinates[index + 1]!;
    const ax = (first[0] - point.longitude) * metersPerLongitude;
    const ay = (first[1] - point.latitude) * metersPerLatitude;
    const bx = (second[0] - point.longitude) * metersPerLongitude;
    const by = (second[1] - point.latitude) * metersPerLatitude;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared));
    const distanceMeters = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    if (distanceMeters < nearest.distanceMeters) {
      const segmentLength = cumulativeDistances[index + 1]! - cumulativeDistances[index]!;
      nearest = {
        distanceMeters,
        progressMeters: cumulativeDistances[index]! + fraction * segmentLength,
        segmentIndex: index,
      };
    }
  }
  return nearest;
}

export function geometryProgressToRouteMeters(
  progressMeters: number,
  route: NavigationRoute,
  cumulative = cumulativeRouteDistances(route.coordinates),
): number {
  const geometryLength = cumulative[cumulative.length - 1] ?? 0;
  return geometryLength > 0 ? Math.min(route.distance, (progressMeters / geometryLength) * route.distance) : 0;
}

export function routeStepDistance(
  route: NavigationRoute,
  stepIndex: number,
  cumulative = cumulativeRouteDistances(route.coordinates),
): number {
  const step = route.steps[stepIndex];
  if (!step) return route.distance;
  const geometryLength = cumulative[cumulative.length - 1] ?? 0;
  const distanceAlongGeometry = cumulative[step.wayPoints[0]] ?? 0;
  return geometryLength > 0 ? (distanceAlongGeometry / geometryLength) * route.distance : 0;
}
