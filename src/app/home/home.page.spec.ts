import '@angular/compiler';
import { beforeEach, describe, expect, it } from 'vitest';

import { Facility } from '../models/facility.model';
import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;

  beforeEach(() => {
    component = Object.create(HomePage.prototype) as HomePage;
    component.searchText = '';
    component.selectedCategory = 'all';
    component.visibleItemCount = 10;
    component.location = null;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('initially exposes only ten matching facilities', () => {
    const facilities = makeFacilities(25);

    expect(component.getVisibleFacilities(facilities)).toHaveLength(10);
    expect(component.filteredFacilityCount(facilities)).toBe(25);
  });

  it('loads the next ten facilities without duplicating earlier cards', async () => {
    const facilities = makeFacilities(25);
    const complete = async () => undefined;
    const event = new Event('ionInfinite');
    Object.defineProperty(event, 'target', { value: { complete } });

    const firstPage = component.getVisibleFacilities(facilities);
    await component.loadMore(event);
    const secondPage = component.getVisibleFacilities(facilities);

    expect(secondPage).toHaveLength(20);
    expect(secondPage.slice(0, 10).map((facility) => facility.id)).toEqual(firstPage.map((facility) => facility.id));
    expect(new Set(secondPage.map((facility) => facility.id)).size).toBe(20);
  });

  it('resets the visible count when search or category selection changes', () => {
    const facilities = makeFacilities(25);
    component.visibleItemCount = 20;
    component.searchText = 'facility 2';
    component.resetVisibleItemCount();
    expect(component.visibleItemCount).toBe(10);
    expect(component.getVisibleFacilities(facilities)).toHaveLength(6);

    component.visibleItemCount = 20;
    component.selectCategory('clinic');
    expect(component.visibleItemCount).toBe(10);
    expect(component.getVisibleFacilities(facilities).every((facility) => facility.category === 'clinic')).toBe(true);

    component.visibleItemCount = 20;
    component.clearFilters();
    expect(component.visibleItemCount).toBe(10);
    expect(component.getVisibleFacilities(facilities)).toHaveLength(10);
  });
});

function makeFacilities(count: number): Facility[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `facility-${index}`,
    name: `Facility ${index}`,
    category: index % 2 === 0 ? 'hospital' : 'clinic',
    address: `Address ${index}`,
    isVerified: true,
    isActive: true,
  }));
}
