
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, IonSpinner,
} from '@ionic/angular';
import * as L from 'leaflet';
import { Subscription } from 'rxjs';
import { FacilityService } from '../../core/facility.service';
import { LocationService } from '../../core/location.service';
import { directionsUrl } from '../../core/facility-utils';
import { Facility, categoryLabels } from '../../models/facility.model';

const categoryNames: Record<Facility['category'], string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  health_center: 'Health center',
};

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  imports: [
    RouterLink,
    IonButton,
    IonContent,
    IonIcon,
    IonSpinner,
],
})
export class MapPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapHost') private mapHost?: ElementRef<HTMLDivElement>;
  private readonly facilitiesService = inject(FacilityService);
  private readonly locationService = inject(LocationService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private map?: L.Map;
  private markers: L.CircleMarker[] = [];
  private openMapMarkers: L.CircleMarker[] = [];
  private facilitiesSubscription?: Subscription;
  private openMapRequest?: AbortController;
  private openMapRefreshTimer?: ReturnType<typeof setTimeout>;
  private lastOpenMapQuery = '';

  readonly categoryLabels = categoryLabels;
  facilities: Facility[] = [];
  openMapFacilities: Facility[] = [];
  selectedFacility: Facility | null = null;
  locationMessage = 'Choose “Use my location” to center the map on your current position.';
  openMapMessage = 'Zoom in to load real healthcare places from OpenStreetMap.';
  loadingOpenMapFacilities = false;
  openMapError = false;
  loadingLocation = false;
  private locationMarker?: L.CircleMarker;

  get visibleFacilities(): Facility[] {
    return [
      ...this.facilities.filter((facility) =>
        !facility.isSample && typeof facility.latitude === 'number' && typeof facility.longitude === 'number'),
      ...this.openMapFacilities,
    ];
  }

  ngOnInit(): void {
    this.facilitiesSubscription = this.facilitiesService.watchActiveFacilities().subscribe({
      next: (facilities) => {
        this.facilities = facilities;
        this.renderFacilityMarkers();
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Map facility data could not be loaded.', error);
        this.locationMessage = 'Facility data could not be loaded. Use the directory to search by name or address.';
        this.changeDetector.markForCheck();
      },
    });
  }

  ngAfterViewInit(): void {
    if (!this.mapHost) return;
    this.map = L.map(this.mapHost.nativeElement, { scrollWheelZoom: false }).setView([12.8797, 121.774], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.map.on('moveend', () => this.scheduleOpenMapRefresh());
    this.renderFacilityMarkers();
    this.scheduleOpenMapRefresh();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  ngOnDestroy(): void {
    this.facilitiesSubscription?.unsubscribe();
    if (this.openMapRefreshTimer) clearTimeout(this.openMapRefreshTimer);
    this.openMapRequest?.abort();
    this.map?.remove();
  }

  async useMyLocation(): Promise<void> {
    this.loadingLocation = true;
    try {
      const position = await this.locationService.getCurrentPosition();
      if (!this.map) return;
      const point: L.LatLngExpression = [position.coords.latitude, position.coords.longitude];
      this.map.setView(point, 14);
      this.locationMarker?.remove();
      this.locationMarker = L.circleMarker(point, {
        radius: 8, color: '#fff', weight: 3, fillColor: '#1976d2', fillOpacity: 1,
      }).addTo(this.map).bindPopup('Your current location');
      this.locationMessage = 'Your location is shown on the map. Distances are not driving distances.';
    } catch (error) {
      this.locationMessage = error instanceof Error ? error.message : 'Could not determine your location.';
    } finally {
      this.loadingLocation = false;
      this.changeDetector.markForCheck();
    }
  }

  selectFacility(facility: Facility): void {
    this.selectedFacility = facility;
    if (this.map && typeof facility.latitude === 'number' && typeof facility.longitude === 'number') {
      this.map.flyTo([facility.latitude, facility.longitude], 15, { duration: 0.35 });
    }
    this.changeDetector.markForCheck();
  }

  directions(facility: Facility): string {
    return directionsUrl(facility);
  }

  retryOpenMapSearch(): void {
    this.lastOpenMapQuery = '';
    this.scheduleOpenMapRefresh(true);
  }

  private renderFacilityMarkers(): void {
    if (!this.map) return;
    this.markers.forEach((marker) => marker.remove());
    this.markers = [];
    for (const facility of this.facilities.filter((item) => !item.isSample)) {
      if (typeof facility.latitude !== 'number' || typeof facility.longitude !== 'number') continue;
      const marker = L.circleMarker([facility.latitude, facility.longitude], {
        radius: 8, color: '#fff', weight: 2, fillColor: '#209887', fillOpacity: 0.95,
      }).addTo(this.map);
      marker.bindPopup(`<strong>${escapeHtml(facility.name || 'Name not provided')}</strong><br>${escapeHtml(facility.address || 'Address not provided')}`);
      marker.on('click', () => {
        this.selectedFacility = facility;
        this.changeDetector.markForCheck();
      });
      this.markers.push(marker);
    }
  }

  private scheduleOpenMapRefresh(force = false): void {
    if (this.openMapRefreshTimer) clearTimeout(this.openMapRefreshTimer);
    this.openMapRequest?.abort();
    this.openMapRequest = undefined;

    const map = this.map;
    if (!map) return;
    if (map.getZoom() < 8) {
      this.lastOpenMapQuery = '';
      this.openMapFacilities = [];
      if (this.selectedFacility?.source === 'openstreetmap') this.selectedFacility = null;
      this.renderOpenMapMarkers();
      this.loadingOpenMapFacilities = false;
      this.openMapError = false;
      this.openMapMessage = 'Zoom in to load real healthcare places from OpenStreetMap.';
      this.changeDetector.markForCheck();
      return;
    }

    const bounds = map.getBounds();
    const south = bounds.getSouth().toFixed(4);
    const west = bounds.getWest().toFixed(4);
    const north = bounds.getNorth().toFixed(4);
    const east = bounds.getEast().toFixed(4);
    const queryKey = `${map.getZoom()}:${south}:${west}:${north}:${east}`;
    if (!force && queryKey === this.lastOpenMapQuery) return;

    this.openMapFacilities = [];
    if (this.selectedFacility?.source === 'openstreetmap') this.selectedFacility = null;
    this.renderOpenMapMarkers();
    this.loadingOpenMapFacilities = true;
    this.openMapError = false;
    this.openMapMessage = 'Loading healthcare places in this map area…';
    this.openMapRefreshTimer = setTimeout(() => {
      void this.fetchOpenMapFacilities(queryKey, south, west, north, east);
    }, 500);
    this.changeDetector.markForCheck();
  }

  private async fetchOpenMapFacilities(
    queryKey: string, south: string, west: string, north: string, east: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.openMapRequest = controller;
    this.loadingOpenMapFacilities = true;
    this.openMapError = false;
    const query = [
      '[out:json][timeout:25];',
      '(',
      ...['node', 'way', 'relation'].flatMap((type) => [
        `${type}["amenity"~"^(hospital|clinic|doctors|pharmacy|health_centre|dentist)$"](${south},${west},${north},${east});`,
        `${type}["healthcare"~"^(hospital|clinic|doctor|pharmacy|health_centre|centre|midwife)$"](${south},${west},${north},${east});`,
      ]),
      ');out center tags;',
    ].join('');

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OpenStreetMap search failed (${response.status}).`);
      const result = await response.json() as OverpassResponse;
      if (controller.signal.aborted) return;

      this.lastOpenMapQuery = queryKey;
      const importedOsmIds = new Set(this.facilities
        .filter((facility) => facility.source === 'openstreetmap' && facility.osmType && facility.osmId)
        .map((facility) => `${facility.osmType}/${facility.osmId}`));
      this.openMapFacilities = result.elements
        .map(toOpenMapFacility)
        .filter((facility): facility is Facility => facility !== null)
        .filter((facility) => !importedOsmIds.has(`${facility.osmType}/${facility.osmId}`));
      this.renderOpenMapMarkers();
      this.openMapMessage = this.openMapFacilities.length
        ? `Showing ${this.openMapFacilities.length} OpenStreetMap places in this area. Map coverage may be incomplete.`
        : 'No OpenStreetMap healthcare places were found in this area. Coverage may be incomplete.';
      this.openMapError = false;
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('OpenStreetMap healthcare places could not be loaded.', error);
      this.openMapMessage = 'Could not load OpenStreetMap healthcare places. Check your connection and try moving the map again.';
      this.openMapError = true;
    } finally {
      if (this.openMapRequest === controller) {
        this.openMapRequest = undefined;
        this.loadingOpenMapFacilities = false;
        this.changeDetector.markForCheck();
      }
    }
  }

  private renderOpenMapMarkers(): void {
    const map = this.map;
    if (!map) return;
    this.openMapMarkers.forEach((marker) => marker.remove());
    this.openMapMarkers = this.openMapFacilities.flatMap((facility) => {
      if (typeof facility.latitude !== 'number' || typeof facility.longitude !== 'number') return [];
      const marker = L.circleMarker([facility.latitude, facility.longitude], {
        radius: 7, color: '#fff', weight: 2, fillColor: '#2878b8', fillOpacity: 0.95,
      }).addTo(map);
      marker.bindPopup(`<strong>${escapeHtml(facility.name)}</strong><br>${escapeHtml(facility.address)}<br><small>OpenStreetMap</small>`);
      marker.on('click', () => {
        this.selectedFacility = facility;
        this.changeDetector.markForCheck();
      });
      return [marker];
    });
  }
}

interface OverpassResponse {
  elements: Array<{
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }>;
}

function toOpenMapFacility(element: OverpassResponse['elements'][number]): Facility | null {
  const tags = element.tags ?? {};
  const category = openMapCategory(tags);
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!category || typeof latitude !== 'number' || typeof longitude !== 'number') return null;

  const city = tags['addr:city'] ?? tags['addr:suburb'] ?? tags['addr:town'] ?? '';
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = tags['addr:full'] || [street, city].filter(Boolean).join(', ') || city || 'Address not listed';
  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags['name'] ?? tags['name:en'] ?? tags['operator'] ?? `Unnamed ${categoryNames[category].toLocaleLowerCase()}`,
    category,
    address,
    city: city || undefined,
    province: tags['addr:state'],
    latitude,
    longitude,
    isVerified: false,
    isActive: true,
    source: 'openstreetmap',
    osmType: element.type === 'node' || element.type === 'way' || element.type === 'relation' ? element.type : undefined,
    osmId: String(element.id),
  };
}

function openMapCategory(tags: Record<string, string>): Facility['category'] | null {
  const healthcare = tags['healthcare'];
  const amenity = tags['amenity'];
  if (healthcare === 'pharmacy' || amenity === 'pharmacy') return 'pharmacy';
  if (healthcare === 'hospital' || amenity === 'hospital') return 'hospital';
  if (healthcare === 'clinic' || healthcare === 'doctor' || amenity === 'clinic'
    || amenity === 'doctors' || amenity === 'dentist') return 'clinic';
  if (healthcare === 'health_centre' || healthcare === 'centre' || healthcare === 'midwife'
    || amenity === 'health_centre') return 'health_center';
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}
