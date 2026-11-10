import { Facility } from '../models/facility.model';
import { distanceBetween } from './navigation-geometry';
import { facilityCoordinates } from './facility-utils';

export interface HospitalRouteDistance {
  distance: number;
  duration: number;
}

export interface NearestHospitalResult {
  facility: Facility;
  distance: number;
  duration: number;
  approximate: boolean;
}

export function selectNearestHospital(
  facilities: readonly Facility[],
  origin: { latitude: number; longitude: number },
  routeDistances: ReadonlyMap<string, HospitalRouteDistance>,
): NearestHospitalResult | null {
  const candidates = facilities
    .filter((facility) => facility.isActive && !facility.isSample && facility.category === 'hospital')
    .flatMap((facility) => {
      const coordinates = facilityCoordinates(facility);
      return coordinates ? [{
        facility,
        straightDistance: distanceBetween(origin, coordinates),
      }] : [];
    });

  if (!candidates.length) return null;

  const routedCandidates = candidates.flatMap((candidate) => {
    const route = routeDistances.get(candidate.facility.id);
    return route && Number.isFinite(route.distance) && route.distance >= 0
      && Number.isFinite(route.duration) && route.duration >= 0
      ? [{ ...candidate, distance: route.distance, duration: route.duration }]
      : [];
  });

  if (routedCandidates.length) {
    const nearest = routedCandidates.reduce((best, candidate) =>
      candidate.distance < best.distance ? candidate : best);
    return {
      facility: nearest.facility,
      distance: nearest.distance,
      duration: nearest.duration,
      approximate: false,
    };
  }

  const nearest = candidates.reduce((best, candidate) =>
    candidate.straightDistance < best.straightDistance ? candidate : best);
  return {
    facility: nearest.facility,
    distance: nearest.straightDistance,
    duration: 0,
    approximate: true,
  };
}
