import { describe, expect, it } from 'vitest';
import {
  cumulativeRouteDistances, distanceBetween, geometryProgressToRouteMeters, isArrivalPosition, nearestRoutePosition,
  routeStepDistance, rerouteCooldownMilliseconds, shouldReroute,
} from './navigation-geometry';
import { NavigationRoute } from './routing.service';

describe('navigation route geometry', () => {
  const route: NavigationRoute = {
    coordinates: [[0, 0], [0.005, 0], [0.01, 0]],
    distance: 1200,
    duration: 300,
    steps: [
      { distance: 600, duration: 150, instruction: 'Continue straight', name: '', wayPoints: [0, 1] },
      { distance: 600, duration: 150, instruction: 'Turn right', name: 'Main Road', wayPoints: [1, 2] },
    ],
  };

  it('measures distance and progress relative to the closest route segment', () => {
    const cumulative = cumulativeRouteDistances(route.coordinates);
    const nearest = nearestRoutePosition(
      { latitude: 0.001, longitude: 0.0025 },
      route.coordinates,
      cumulative,
    );

    expect(nearest.distanceMeters).toBeGreaterThan(100);
    expect(nearest.progressMeters).toBeCloseTo(cumulative[1]! / 2, -1);
    expect(geometryProgressToRouteMeters(nearest.progressMeters, route, cumulative)).toBeCloseTo(300, -1);
  });

  it('calculates the next step distance and destination separation', () => {
    const cumulative = cumulativeRouteDistances(route.coordinates);
    expect(routeStepDistance(route, 1, cumulative)).toBeCloseTo(600, -1);
    expect(distanceBetween(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.01 },
    )).toBeGreaterThan(1000);
  });

  it('requires an accurate fix close to the destination before declaring arrival', () => {
    expect(isArrivalPosition(30, 20)).toBe(true);
    expect(isArrivalPosition(36, 10)).toBe(false);
    expect(isArrivalPosition(20, 60)).toBe(false);
  });

  it('applies an off-route threshold, GPS accuracy limit, and reroute cooldown', () => {
    expect(shouldReroute(51, 30, rerouteCooldownMilliseconds)).toBe(true);
    expect(shouldReroute(50, 20, rerouteCooldownMilliseconds)).toBe(false);
    expect(shouldReroute(80, 60, rerouteCooldownMilliseconds)).toBe(false);
    expect(shouldReroute(80, 20, rerouteCooldownMilliseconds - 1)).toBe(false);
  });
});
