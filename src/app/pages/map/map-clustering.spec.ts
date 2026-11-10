import { afterEach, describe, expect, it } from 'vitest';
import * as Leaflet from 'leaflet';
import type * as LeafletTypes from 'leaflet';
import 'leaflet.markercluster';

const L: typeof Leaflet = (globalThis as typeof globalThis & { L?: typeof Leaflet }).L ?? Leaflet;

describe('facility marker clustering', () => {
  let map: LeafletTypes.Map | undefined;

  afterEach(() => {
    map?.remove();
    map = undefined;
    document.body.replaceChildren();
  });

  it('groups nearby markers at low zoom and exposes child counts', () => {
    expect(typeof L.markerClusterGroup).toBe('function');

    const host = document.createElement('div');
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    host.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}),
    });
    document.body.append(host);

    map = L.map(host, { zoomControl: false, attributionControl: false, maxZoom: 19 }).setView([0, 0], 5);
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 70,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      removeOutsideVisibleBounds: true,
      animate: false,
      animateAddingMarkers: false,
      chunkedLoading: false,
    }).addTo(map);
    const markers = [L.marker([0, 0]), L.marker([0.001, 0.001])];
    cluster.addLayers(markers);

    const parent = cluster.getVisibleParent(markers[0]!);
    expect(parent).not.toBe(markers[0]);
    expect(parent).toBeInstanceOf(L.MarkerCluster);
    expect((parent as LeafletTypes.MarkerCluster).getChildCount()).toBe(2);

    map.setZoom(19);
    expect(cluster.getVisibleParent(markers[0]!)).toBe(markers[0]);

    map.setZoom(5);
    const reclusteredParent = cluster.getVisibleParent(markers[0]!);
    expect(reclusteredParent).toBeInstanceOf(L.MarkerCluster);
    expect((reclusteredParent as LeafletTypes.MarkerCluster).getChildCount()).toBe(2);
  });
});
