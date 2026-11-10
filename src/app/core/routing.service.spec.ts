import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import { RoutingService } from './routing.service';

describe('RoutingService', () => {
  const originalApiKey = environment.openRouteServiceApiKey;
  const fetchMock = vi.fn<typeof fetch>();
  const routeResponse = {
    features: [{
      geometry: { coordinates: [[121, 14], [121.001, 14.001]] },
      properties: {
        summary: { distance: 500, duration: 120 },
        segments: [{
          steps: [
            { distance: 250, duration: 60, instruction: 'Continue straight', name: 'Main Road', way_points: [0, 1] },
          ],
        }],
      },
    }],
  };

  beforeEach(() => {
    environment.openRouteServiceApiKey = 'test-api-key';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    environment.openRouteServiceApiKey = originalApiKey;
    vi.unstubAllGlobals();
  });

  it('requests a driving-car route and parses its geometry, summary, and steps', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(routeResponse), { status: 200 }));

    const route = await new RoutingService().getDrivingRoute(
      { latitude: 14, longitude: 121 },
      { latitude: 14.001, longitude: 121.001 },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'test-api-key', 'Content-Type': 'application/json' },
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      coordinates: [[121, 14], [121.001, 14.001]],
      instructions: true,
      instructions_format: 'text',
      language: 'en',
    });
    expect(route).toEqual({
      coordinates: [[121, 14], [121.001, 14.001]],
      distance: 500,
      duration: 120,
      steps: [{
        distance: 250,
        duration: 60,
        instruction: 'Continue straight',
        name: 'Main Road',
        wayPoints: [0, 1],
      }],
    });
  });

  it('requests driving distances for all supplied destinations in one matrix call', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      distances: [[500, null]],
      durations: [[120, null]],
    }), { status: 200 }));

    const matrix = await new RoutingService().getDrivingDistanceMatrix(
      { latitude: 14, longitude: 121 },
      [
        { latitude: 14.001, longitude: 121.001 },
        { latitude: 14.002, longitude: 121.002 },
      ],
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openrouteservice.org/v2/matrix/driving-car',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'test-api-key', 'Content-Type': 'application/json' },
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      locations: [[121, 14], [121.001, 14.001], [121.002, 14.002]],
      sources: ['0'],
      destinations: ['1', '2'],
      metrics: ['distance', 'duration'],
    });
    expect(matrix).toEqual([{ distance: 500, duration: 120 }, null]);
  });

  it('rejects invalid or oversized driving distance batches before fetching', async () => {
    await expect(new RoutingService().getDrivingDistanceMatrix(
      { latitude: 14, longitude: 121 },
      [],
    )).rejects.toThrow('between 1 and');

    await expect(new RoutingService().getDrivingDistanceMatrix(
      { latitude: 91, longitude: 121 },
      [{ latitude: 14, longitude: 121 }],
    )).rejects.toThrow('current location does not have valid coordinates');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unconfigured API key without making a network request', async () => {
    environment.openRouteServiceApiKey = '';

    await expect(new RoutingService().getDrivingRoute(
      { latitude: 14, longitude: 121 },
      { latitude: 14.001, longitude: 121.001 },
    )).rejects.toThrow('OpenRouteService is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the API error message when route calculation fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'Invalid API key' },
    }), { status: 401 }));

    await expect(new RoutingService().getDrivingRoute(
      { latitude: 14, longitude: 121 },
      { latitude: 14.001, longitude: 121.001 },
    )).rejects.toThrow('Invalid API key');
  });
});
