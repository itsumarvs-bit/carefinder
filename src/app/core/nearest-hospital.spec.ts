import { describe, expect, it } from 'vitest';
import { Facility } from '../models/facility.model';
import { selectNearestHospital } from './nearest-hospital';

describe('selectNearestHospital', () => {
  const origin = { latitude: 14, longitude: 121 };
  const hospital = (id: string, latitude: number, overrides: Partial<Facility> = {}): Facility => ({
    id,
    name: id,
    category: 'hospital',
    address: '',
    latitude,
    longitude: 121,
    isActive: true,
    isVerified: false,
    ...overrides,
  });

  it('uses driving distances across all eligible hospitals, even when straight-line ranking differs', () => {
    const straightLineClosest = hospital('straight-line-closest', 14.001);
    const drivingClosest = hospital('driving-closest', 14.02);

    const result = selectNearestHospital(
      [straightLineClosest, drivingClosest],
      origin,
      new Map([
        [straightLineClosest.id, { distance: 18_000, duration: 1_800 }],
        [drivingClosest.id, { distance: 3_000, duration: 300 }],
      ]),
    );

    expect(result).toEqual({
      facility: drivingClosest,
      distance: 3_000,
      duration: 300,
      approximate: false,
    });
  });

  it('uses straight-line distance when no valid driving distances are available', () => {
    const nearer = hospital('nearer', 14.001);
    const farther = hospital('farther', 14.02);

    const result = selectNearestHospital([farther, nearer], origin, new Map());

    expect(result?.facility).toBe(nearer);
    expect(result?.approximate).toBe(true);
    expect(result?.distance).toBeGreaterThan(0);
    expect(result?.duration).toBe(0);
  });

  it('ignores inactive, sample, non-hospital, and invalid-coordinate facilities', () => {
    const eligible = hospital('eligible', 14.001);

    const result = selectNearestHospital([
      hospital('inactive', 14.0001, { isActive: false }),
      hospital('sample', 14.0002, { isSample: true }),
      hospital('bad-coordinates', 14.0003, { longitude: 181 }),
      hospital('clinic', 14.0004, { category: 'clinic' }),
      eligible,
    ], origin, new Map());

    expect(result?.facility).toBe(eligible);
  });

  it('returns null when no eligible hospital is available', () => {
    expect(selectNearestHospital([hospital('inactive', 14, { isActive: false })], origin, new Map()))
      .toBeNull();
  });
});
