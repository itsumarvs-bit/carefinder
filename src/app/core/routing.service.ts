import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import type { HospitalRouteDistance } from './nearest-hospital';

export const drivingMatrixDestinationBatchSize = 49;

export interface NavigationStep {
  distance: number;
  duration: number;
  instruction: string;
  name: string;
  wayPoints: [number, number];
}

export interface NavigationRoute {
  coordinates: Array<[number, number]>;
  distance: number;
  duration: number;
  steps: NavigationStep[];
}

@Injectable({ providedIn: 'root' })
export class RoutingService {
  async getDrivingDistanceMatrix(
    start: { latitude: number; longitude: number },
    destinations: Array<{ latitude: number; longitude: number }>,
  ): Promise<Array<HospitalRouteDistance | null>> {
    const apiKey = environment.openRouteServiceApiKey.trim();
    if (!apiKey) {
      throw new Error('OpenRouteService is not configured. Add an API key to src/environments/environment.ts before searching for hospitals.');
    }
    if (!destinations.length || destinations.length > drivingMatrixDestinationBatchSize) {
      throw new Error(`Driving distance batches must contain between 1 and ${drivingMatrixDestinationBatchSize} destinations.`);
    }
    validateCoordinate(start.latitude, start.longitude, 'current location');
    destinations.forEach((destination) => validateCoordinate(
      destination.latitude, destination.longitude, 'facility',
    ));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locations: [
            [start.longitude, start.latitude],
            ...destinations.map((destination) => [destination.longitude, destination.latitude]),
          ],
          sources: ['0'],
          destinations: destinations.map((_destination, index) => String(index + 1)),
          metrics: ['distance', 'duration'],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('OpenRouteService took too long to compare hospital routes. Check your connection and try again.');
      }
      throw new Error('Could not reach OpenRouteService. Check your internet connection and try again.');
    } finally {
      clearTimeout(timeout);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(apiErrorMessage(payload) ?? `OpenRouteService could not compare hospital routes (${response.status}).`);
    }

    const matrix = recordAt(payload);
    const distances = matrix?.['distances'];
    const durations = matrix?.['durations'];
    const distanceRow = Array.isArray(distances) ? distances[0] : undefined;
    const durationRow = Array.isArray(durations) ? durations[0] : undefined;
    if (!Array.isArray(distanceRow) || !Array.isArray(durationRow)
      || distanceRow.length !== destinations.length || durationRow.length !== destinations.length) {
      throw new Error('OpenRouteService returned an incomplete hospital distance matrix.');
    }
    return destinations.map((_destination, index) => {
      const distance = distanceRow[index];
      const duration = durationRow[index];
      if (distance === null || duration === null) return null;
      if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0
        || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
        throw new Error('OpenRouteService returned invalid hospital route metrics.');
      }
      return { distance, duration };
    });
  }

  async getDrivingRoute(
    start: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number },
  ): Promise<NavigationRoute> {
    const apiKey = environment.openRouteServiceApiKey.trim();
    if (!apiKey) {
      throw new Error('OpenRouteService is not configured. Add an API key to src/environments/environment.ts before starting navigation.');
    }

    validateCoordinate(start.latitude, start.longitude, 'current location');
    validateCoordinate(destination.latitude, destination.longitude, 'facility');

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [start.longitude, start.latitude],
            [destination.longitude, destination.latitude],
          ],
          instructions: true,
          instructions_format: 'text',
          language: 'en',
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('OpenRouteService took too long to calculate a route. Check your connection and try again.');
      }
      throw new Error('Could not reach OpenRouteService. Check your internet connection and try again.');
    } finally {
      clearTimeout(timeout);
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(apiErrorMessage(payload) ?? `OpenRouteService could not calculate a route (${response.status}).`);
    }
    return parseRoute(payload);
  }
}

function parseRoute(payload: unknown): NavigationRoute {
  const feature = recordAt(recordAt(payload)?.['features'], 0);
  const geometry = recordAt(feature?.['geometry']);
  const properties = recordAt(feature?.['properties']);
  const summary = recordAt(properties?.['summary']);
  const segment = recordAt(properties?.['segments'], 0);
  const rawCoordinates = geometry?.['coordinates'];
  const rawSteps = segment?.['steps'];

  if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2 || !Array.isArray(rawSteps)) {
    throw new Error('OpenRouteService returned an incomplete route. Please try again.');
  }

  const coordinates = rawCoordinates.map((point): [number, number] => {
    if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number'
      || !Number.isFinite(point[0]) || point[0] < -180 || point[0] > 180
      || !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90) {
      throw new Error('OpenRouteService returned invalid route geometry.');
    }
    return [point[0], point[1]];
  });
  const distance = summary?.['distance'];
  const duration = summary?.['duration'];
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0
    || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new Error('OpenRouteService returned invalid distance or travel time.');
  }

  const steps = rawSteps.map((value): NavigationStep => {
    const step = recordAt(value);
    const wayPoints = step?.['way_points'];
    const stepDistance = step?.['distance'];
    const stepDuration = step?.['duration'];
    const instruction = step?.['instruction'];
    const startPoint = Array.isArray(wayPoints) ? wayPoints[0] : undefined;
    const endPoint = Array.isArray(wayPoints) ? wayPoints[1] : undefined;
    if (!step || !Array.isArray(wayPoints) || wayPoints.length < 2
      || typeof startPoint !== 'number' || !Number.isInteger(startPoint)
      || typeof endPoint !== 'number' || !Number.isInteger(endPoint)
      || startPoint < 0 || endPoint >= coordinates.length || startPoint > endPoint
      || typeof stepDistance !== 'number' || !Number.isFinite(stepDistance)
      || typeof stepDuration !== 'number' || !Number.isFinite(stepDuration)
      || typeof instruction !== 'string' || !instruction.trim()) {
      throw new Error('OpenRouteService returned an invalid navigation instruction.');
    }
    return {
      distance: stepDistance,
      duration: stepDuration,
      instruction,
      name: typeof step['name'] === 'string' ? step['name'] : '',
      wayPoints: [startPoint, endPoint],
    };
  });

  if (!steps.length) throw new Error('OpenRouteService did not return any navigation instructions.');
  return { coordinates, distance, duration, steps };
}

function recordAt(value: unknown, index?: number): Record<string, unknown> | undefined {
  const item = index === undefined ? value : Array.isArray(value) ? value[index] : undefined;
  return typeof item === 'object' && item !== null && !Array.isArray(item)
    ? item as Record<string, unknown>
    : undefined;
}

function validateCoordinate(latitude: number, longitude: number, label: string): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(`The ${label} does not have valid coordinates.`);
  }
}

function apiErrorMessage(payload: unknown): string | undefined {
  const error = recordAt(recordAt(payload)?.['error']);
  return typeof error?.['message'] === 'string' ? error['message'] : undefined;
}
