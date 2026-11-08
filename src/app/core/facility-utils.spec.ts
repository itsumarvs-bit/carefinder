import { describe, expect, it } from 'vitest';
import { Facility } from '../models/facility.model';
import { facilityDistanceKm, facilityOpenStatus } from './facility-utils';

describe('facilityDistanceKm', () => {
  it('calculates approximate great-circle distance', () => {
    const from = { latitude: 0, longitude: 0 } as GeolocationCoordinates;
    const facility: Facility = {
      id: 'test', name: 'Test', category: 'clinic', address: 'Test address',
      latitude: 1, longitude: 0, isVerified: false, isActive: true,
    };
    expect(facilityDistanceKm(from, facility)).toBeCloseTo(111.2, 0);
  });

  it('returns null when coordinates are not available', () => {
    const from = { latitude: 0, longitude: 0 } as GeolocationCoordinates;
    const facility: Facility = {
      id: 'test', name: 'Test', category: 'clinic', address: 'Test address',
      isVerified: false, isActive: true,
    };
    expect(facilityDistanceKm(from, facility)).toBeNull();
  });
});

describe('facilityOpenStatus', () => {
  const facility: Facility = {
    id: 'test', name: 'Test', category: 'clinic', address: 'Test address',
    isVerified: false, isActive: true, timeZone: 'UTC',
  };

  it('reports open and closed within the facility timezone', () => {
    const withHours: Facility = {
      ...facility,
      operatingHours: { monday: { open: '09:00', close: '17:00', closed: false } },
    };
    expect(facilityOpenStatus(withHours, new Date('2025-01-06T10:00:00Z'))).toBe('Open now');
    expect(facilityOpenStatus(withHours, new Date('2025-01-06T18:00:00Z'))).toBe('Closed');
  });

  it('recognizes an overnight schedule from the previous local day', () => {
    const withHours: Facility = {
      ...facility,
      operatingHours: {
        monday: { open: '22:00', close: '02:00', closed: false },
        tuesday: { closed: true },
      },
    };
    expect(facilityOpenStatus(withHours, new Date('2025-01-07T01:00:00Z'))).toBe('Open now');
  });

  it('does not assume the facility is open when hours are unavailable', () => {
    expect(facilityOpenStatus(facility, new Date('2025-01-06T10:00:00Z'))).toBe('Hours unavailable');
  });
});
