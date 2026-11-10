import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { FacilityDetailsPage } from './facility-details.page';

describe('FacilityDetailsPage contact actions', () => {
  const page = Object.create(FacilityDetailsPage.prototype) as FacilityDetailsPage;

  it('creates dial and email links only for valid contact details', () => {
    expect(page.phoneHref({
      id: 'facility', name: 'Facility', category: 'clinic', address: '', isActive: true, isVerified: false,
      contactNumber: '+1 (555) 123-4567',
    })).toBe('tel:+15551234567');
    expect(page.phoneHref({
      id: 'facility', name: 'Facility', category: 'clinic', address: '', isActive: true, isVerified: false,
      contactNumber: '12345',
    })).toBeUndefined();
    expect(page.emailHref('care@example.com')).toBe('mailto:care%40example.com');
    expect(page.emailHref('not-an-email')).toBeUndefined();
  });

  it('allows only HTTP(S) facility websites', () => {
    const facility = {
      id: 'facility', name: 'Facility', category: 'clinic' as const, address: '', isActive: true, isVerified: false,
    };
    expect(page.websiteHref({ ...facility, website: 'https://care.example.com' }))
      .toBe('https://care.example.com/');
    expect(page.websiteHref({ ...facility, website: 'javascript:alert(1)' })).toBeUndefined();
  });
});
