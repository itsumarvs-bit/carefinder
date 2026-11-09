import { describe, expect, it } from 'vitest';
import { Facility } from '../models/facility.model';
import {
  facilityCoordinates, facilityDistanceKm, facilityOpenStatus, normalizeFacilityCoordinates,
} from './facility-utils';

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

describe('facilityCoordinates', () => {
  it('accepts numeric strings from existing Firestore records', () => {
    expect(facilityCoordinates({ latitude: '14.5995', longitude: '120.9842' } as unknown as Facility))
      .toEqual({ latitude: 14.5995, longitude: 120.9842 });
  });

  it('rejects non-finite and out-of-range coordinates', () => {
    expect(facilityCoordinates({ latitude: Number.NaN, longitude: 120 } )).toBeNull();
    expect(facilityCoordinates({ latitude: 91, longitude: 120 })).toBeNull();
    expect(facilityCoordinates({ latitude: 14, longitude: -181 })).toBeNull();
  });

  it('normalizes valid coordinates without changing invalid records', () => {
    const facility: Facility = {
      id: 'test', name: 'Test', category: 'clinic', address: 'Test address',
      latitude: 14, longitude: 120, isVerified: false, isActive: true,
    };
    expect(normalizeFacilityCoordinates(facility)).toEqual(facility);
    expect(normalizeFacilityCoordinates({
      ...facility, latitude: '14.5', longitude: '120.5',
    } as unknown as Facility)).toMatchObject({ latitude: 14.5, longitude: 120.5 });
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
