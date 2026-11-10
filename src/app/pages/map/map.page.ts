
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild, inject, isDevMode } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, IonSpinner,
} from '@ionic/angular';
import type { Position } from '@capacitor/geolocation';
import * as Leaflet from 'leaflet';
import type * as LeafletTypes from 'leaflet';
import 'leaflet.markercluster';
import { Subscription } from 'rxjs';
import { cloudinaryImageUrl } from '../../core/cloudinary.service';
import { FacilityService } from '../../core/facility.service';
import { LocationService } from '../../core/location.service';
import {
  cumulativeRouteDistances, distanceBetween, geometryProgressToRouteMeters, isArrivalPosition, nearestRoutePosition,
  routeStepDistance, rerouteCooldownMilliseconds, shouldReroute,
} from '../../core/navigation-geometry';
import { NavigationRoute, RoutingService } from '../../core/routing.service';
import { VoiceNavigationService } from '../../core/voice-navigation.service';
import { directionsUrl, facilityCoordinates, normalizeFacilityCoordinates } from '../../core/facility-utils';
import { Facility, FacilityCategory, categoryLabels } from '../../models/facility.model';

const L: typeof Leaflet = (globalThis as typeof globalThis & { L?: typeof Leaflet }).L ?? Leaflet;

const categoryNames: Record<Facility['category'], string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  pharmacy: 'Pharmacy',
  health_center: 'Health center',
};

const categoryIcons: Record<Facility['category'], string> = {
  hospital: 'medical',
  clinic: 'pulse-outline',
  pharmacy: 'bandage-outline',
  health_center: 'medkit-outline',
};

const categoryMarkerColors: Record<Facility['category'], string> = {
  hospital: '#2778a9',
  clinic: '#258875',
  pharmacy: '#8a67a8',
  health_center: '#d18439',
};

type NavigationStatus = 'idle' | 'loading' | 'navigating' | 'paused' | 'arrived';

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
  private readonly route = inject(ActivatedRoute);
  private readonly facilitiesService = inject(FacilityService);
  private readonly locationService = inject(LocationService);
  private readonly routingService = inject(RoutingService);
  private readonly voiceService = inject(VoiceNavigationService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly zone = inject(NgZone);
  private map?: LeafletTypes.Map;
  private tileLayer?: LeafletTypes.TileLayer;
  private resizeObserver?: ResizeObserver;
  private invalidateTimer?: ReturnType<typeof setTimeout>;
  private pageVisible = false;
  private lastTileErrorLogAt = 0;
  private lastFacilitySnapshotDiagnostics = '';
  private lastMarkerDiagnostics = '';
  private markerCluster?: LeafletTypes.MarkerClusterGroup;
  private readonly facilityMarkers = new Map<string, LeafletTypes.Marker>();
  private readonly facilityMarkerSignatures = new Map<string, string>();
  private readonly openMapMarkerById = new Map<string, LeafletTypes.Marker>();
  private readonly openMapMarkerSignatures = new Map<string, string>();
  private facilitiesSubscription?: Subscription;
  private openMapRequest?: AbortController;
  private openMapRefreshTimer?: ReturnType<typeof setTimeout>;
  private lastOpenMapQuery = '';
  private destroyed = false;
  private routeLayer?: LeafletTypes.Polyline;
  private destinationMarker?: LeafletTypes.Marker;
  private navigationPosition?: Position;
  private navigationRoute?: NavigationRoute;
  private navigationFacility?: Facility;
  private navigationStatus: NavigationStatus = 'idle';
  private routeCumulativeDistances: number[] = [];
  private routeProgressMeters = 0;
  private nextStepIndex = -1;
  private turnDistanceMeters = 0;
  private remainingDistanceMeters = 0;
  private remainingDurationSeconds = 0;
  private currentInstruction = '';
  private rerouting = false;
  private lastRerouteAt = 0;
  private readonly announcedThresholds = new Set<string>();

  readonly categoryLabels = categoryLabels;
  readonly categoryOptions: Array<{ id: FacilityCategory | 'all'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'hospital', label: 'Hospital' },
    { id: 'clinic', label: 'Clinic' },
    { id: 'pharmacy', label: 'Pharmacy' },
    { id: 'health_center', label: 'Health center' },
  ];
  facilities: Facility[] = [];
  openMapFacilities: Facility[] = [];
  selectedFacility: Facility | null = null;
  locationMessage = 'Choose “Use my location” to center the map on your current position.';
  openMapMessage = 'Zoom in to load real healthcare places from OpenStreetMap.';
  loadingOpenMapFacilities = false;
  openMapError = false;
  loadingLocation = false;
  sheetExpanded = false;
  navigationLoading = false;
  navigationError = '';
  voiceSupported = this.voiceService.supported;
  voiceMuted = this.voiceService.muted;
  rerouteLoading = false;
  searchText = '';
  categoryFilter: FacilityCategory | 'all' = 'all';
  readonly maxListItems = 100;
  private locationMarker?: LeafletTypes.CircleMarker;

  get visibleFacilities(): Facility[] {
    return [
      ...this.facilities.filter((facility) =>
        !facility.isSample && facilityCoordinates(facility) !== null),
      ...this.openMapFacilities,
    ];
  }

  get filteredFacilities(): Facility[] {
    const query = this.searchText.trim().toLocaleLowerCase();
    return this.visibleFacilities.filter((facility) => this.matchesFacility(facility, query));
  }

  get listedFacilities(): Facility[] {
    return this.filteredFacilities.slice(0, this.maxListItems);
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const destinationId = params.get('destination');
      if (!destinationId) return;
      const facility = [...this.facilities, ...this.openMapFacilities]
        .find((item) => item.id === destinationId);
      if (facility) this.selectFacility(facility);
    });
    this.facilitiesSubscription = this.facilitiesService.watchActiveFacilities().subscribe({
      next: (facilities) => {
        this.facilities = facilities.map(normalizeFacilityCoordinates);
        const activeFacilities = this.facilities.filter((facility) => facility.isActive);
        const markerCandidates = activeFacilities.filter((facility) => !facility.isSample);
        const validCoordinateCount = markerCandidates.filter((facility) => facilityCoordinates(facility) !== null).length;
        const likelyReversedCoordinates = markerCandidates.filter(hasLikelyReversedCoordinates).length;
        const categoryCounts = { hospital: 0, clinic: 0, pharmacy: 0, health_center: 0 };
        let invalidCategories = 0;
        for (const facility of activeFacilities) {
          if (!isFacilityCategory(facility.category)) {
            invalidCategories += 1;
            continue;
          }
          categoryCounts[facility.category] += 1;
        }
        const snapshotDiagnostics = {
          returned: facilities.length,
          active: activeFacilities.length,
          sampleRecords: activeFacilities.length - markerCandidates.length,
          categories: categoryCounts,
          invalidCategories,
          validCoordinates: validCoordinateCount,
          invalidCoordinates: markerCandidates.length - validCoordinateCount,
          likelyReversedCoordinates,
          coordinateFields: summarizeCoordinateFields(facilities),
        };
        const snapshotDiagnosticsKey = JSON.stringify(snapshotDiagnostics);
        if (snapshotDiagnosticsKey !== this.lastFacilitySnapshotDiagnostics) {
          console.info('[CareFinder map] Facilities received', snapshotDiagnostics);
          this.lastFacilitySnapshotDiagnostics = snapshotDiagnosticsKey;
        }
        if (this.selectedFacility) {
          this.selectedFacility = [...this.facilities, ...this.openMapFacilities]
            .find((facility) => facility.id === this.selectedFacility?.id) ?? null;
        }
        this.selectDestinationFromUrl();
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
    const host = this.mapHost?.nativeElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.pageVisible) return;
      if (!this.map) this.initializeMapWhenSized();
      else this.scheduleMapInvalidation('container-resize', 80);
    });
    this.resizeObserver.observe(host);
  }

  ionViewDidEnter(): void {
    this.pageVisible = true;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!this.map) this.initializeMapWhenSized();
      else this.scheduleMapInvalidation('page-enter', 180);
    }));
  }

  ionViewWillLeave(): void {
    this.pageVisible = false;
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
  }

  private initializeMapWhenSized(): void {
    const host = this.mapHost?.nativeElement;
    if (!host || !this.pageVisible || this.map) return;
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) {
      if (isDevMode()) console.debug('Leaflet map initialization deferred until its container has dimensions.', { width, height });
      return;
    }

    if (isDevMode()) console.debug('Initializing Leaflet map.', { width, height });
    const globalLeaflet = (window as Window & { L?: typeof L }).L;
    const clusterPluginAvailable = typeof L.markerClusterGroup === 'function';
    console.info('[CareFinder map] MarkerCluster runtime', {
      leafletVersion: L.version,
      mapPluginAvailable: clusterPluginAvailable,
      globalLeafletAvailable: Boolean(globalLeaflet),
      globalPluginAvailable: typeof globalLeaflet?.markerClusterGroup === 'function',
      mapUsesGlobalLeaflet: globalLeaflet === L,
    });
    if (!clusterPluginAvailable) {
      throw new Error('Leaflet.markercluster did not register on the Leaflet instance used by the map.');
    }

    this.map = L.map(host, { scrollWheelZoom: false }).setView([12.8797, 121.774], 6);
    this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 3,
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    });
    this.tileLayer.on('loading', () => {
      if (isDevMode()) console.debug('OpenStreetMap tiles loading.');
    });
    this.tileLayer.on('load', () => {
      if (isDevMode()) console.debug('OpenStreetMap tiles loaded.');
    });
    this.tileLayer.on('tileerror', (event) => {
      const now = Date.now();
      if (isDevMode() && now - this.lastTileErrorLogAt >= 10_000) {
        this.lastTileErrorLogAt = now;
        console.warn('An OpenStreetMap tile failed to load; Leaflet will not retry it automatically.', event.error);
      }
    });
    this.tileLayer.addTo(this.map);
    this.markerCluster = L.markerClusterGroup({
      maxClusterRadius: 70,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      removeOutsideVisibleBounds: true,
      animate: false,
      animateAddingMarkers: false,
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 25,
      clusterPane: 'markerPane',
      iconCreateFunction: createClusterIcon,
      chunkProgress: (processed, total) => {
        if (processed !== total) return;
        console.info('[CareFinder map] MarkerCluster batch complete', {
          processed,
          total,
          clusterAttachedToMap: Boolean(this.map && this.markerCluster && this.map.hasLayer(this.markerCluster)),
          totalMarkersInCluster: this.markerCluster?.getLayers().length ?? 0,
          bounds: this.map?.getBounds().toBBoxString(),
        });
      },
    }).addTo(this.map);
    this.map.on('moveend', () => this.scheduleOpenMapRefresh());
    this.map.whenReady(() => {
      if (this.destroyed) return;
      this.renderFacilityMarkers();
      this.renderOpenMapMarkers();
      this.logMapPosition('map-ready');
      this.scheduleOpenMapRefresh();
    });
    this.scheduleMapInvalidation('map-initialized', 80);
  }

  private scheduleMapInvalidation(reason: string, delay = 100): void {
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
    this.invalidateTimer = setTimeout(() => {
      this.invalidateTimer = undefined;
      const host = this.mapHost?.nativeElement;
      if (!this.pageVisible || !this.map || !host?.isConnected) return;
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) {
        if (isDevMode()) console.debug('Leaflet size invalidation skipped for a zero-sized container.', { reason, width, height });
        return;
      }
      this.map.invalidateSize({ pan: false, debounceMoveend: true });
      if (isDevMode()) console.debug('Leaflet map size invalidated.', { reason, width, height });
    }, delay);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.pageVisible) {
      if (!this.map) this.initializeMapWhenSized();
      else this.scheduleMapInvalidation('window-resize', 120);
    }
  }

  @HostListener('window:orientationchange')
  onOrientationChange(): void {
    if (!this.pageVisible) return;
    if (!this.map) this.initializeMapWhenSized();
    else this.scheduleMapInvalidation('orientation-change', 250);
  }

  private logMapPosition(reason: string): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    console.info('[CareFinder map] Map position', {
      reason,
      zoom: this.map.getZoom(),
      center: { latitude: center.lat, longitude: center.lng },
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.navigationStatus = 'idle';
    this.navigationFacility = undefined;
    this.facilitiesSubscription?.unsubscribe();
    if (this.openMapRefreshTimer) clearTimeout(this.openMapRefreshTimer);
    if (this.invalidateTimer) clearTimeout(this.invalidateTimer);
    this.resizeObserver?.disconnect();
    this.openMapRequest?.abort();
    this.voiceService.stop();
    void this.locationService.stopWatchingNavigationPosition().catch((error: unknown) => {
      console.error('Navigation GPS watcher could not be cleared.', error);
    });
    this.map?.remove();
  }

  async useMyLocation(): Promise<void> {
    this.loadingLocation = true;
    try {
      const position = await this.locationService.getCurrentPosition();
      if (!this.map) return;
      const point: LeafletTypes.LatLngExpression = [position.coords.latitude, position.coords.longitude];
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
    if (this.selectedFacility?.id !== facility.id) this.sheetExpanded = false;
    this.selectedFacility = facility;
    const coordinates = facilityCoordinates(facility);
    if (this.map && coordinates) {
      const marker = this.facilityMarkers.get(facility.id) ?? this.openMapMarkerById.get(facility.id);
      this.map.flyTo([coordinates.latitude, coordinates.longitude], Math.max(15, this.map.getZoom()), { duration: 0.35 });
      if (marker && this.markerCluster) {
        this.markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
      }
    }
    this.scheduleMapInvalidation('facility-selection', 320);
    this.changeDetector.markForCheck();
  }

  toggleSheet(): void {
    this.sheetExpanded = !this.sheetExpanded;
    this.scheduleMapInvalidation('facility-sheet-toggle', 320);
  }

  closeFacilitySheet(): void {
    this.selectedFacility = null;
    this.sheetExpanded = false;
    this.map?.closePopup();
    this.scheduleMapInvalidation('facility-sheet-close', 320);
  }

  zoomMap(direction: 1 | -1): void {
    if (direction > 0) this.map?.zoomIn();
    else this.map?.zoomOut();
  }

  directions(facility: Facility): string {
    return directionsUrl(facility);
  }

  hasInternalDetails(facility: Facility): boolean {
    return facility.source !== 'openstreetmap' && !/^osm[-_]/.test(facility.id);
  }

  canNavigate(facility: Facility): boolean {
    return facilityCoordinates(facility) !== null;
  }

  get navigationVisible(): boolean {
    return this.navigationStatus !== 'idle';
  }

  get navigationIdle(): boolean {
    return this.navigationStatus === 'idle';
  }

  get navigationPaused(): boolean {
    return this.navigationStatus === 'paused';
  }

  get navigationArrived(): boolean {
    return this.navigationStatus === 'arrived';
  }

  get navigationInProgress(): boolean {
    return this.navigationStatus === 'navigating';
  }

  get navigationFacilityName(): string {
    return this.navigationFacility ? this.facilityName(this.navigationFacility) : '';
  }

  get navigationLocationText(): string {
    if (!this.navigationPosition) return 'Waiting for GPS location';
    const { latitude, longitude } = this.navigationPosition.coords;
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }

  get navigationRemainingText(): string {
    return formatDistance(this.remainingDistanceMeters);
  }

  get navigationTurnDistanceText(): string {
    return formatDistance(this.turnDistanceMeters);
  }

  get navigationTimeText(): string {
    return formatArrivalTime(this.remainingDurationSeconds);
  }

  get navigationDurationText(): string {
    return formatDuration(this.remainingDurationSeconds);
  }

  get navigationMuteLabel(): string {
    return this.voiceMuted ? 'Unmute voice' : 'Mute voice';
  }

  async startNavigation(): Promise<void> {
    const facility = this.selectedFacility;
    if (!facility || !this.canNavigate(facility) || this.navigationStatus !== 'idle') return;

    this.voiceService.prime();
    this.navigationLoading = true;
    this.navigationError = '';
    this.navigationStatus = 'loading';
    this.navigationFacility = facility;
    this.changeDetector.markForCheck();

    try {
      const destination = facilityCoordinates(facility);
      if (!destination) throw new Error('This facility does not have valid coordinates.');
      const position = await this.locationService.getNavigationPosition();
      if (this.destroyed) return;
      this.navigationPosition = position;
      this.updateNavigationLocationMarker(position);
      const route = await this.routingService.getDrivingRoute({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }, destination);
      if (this.destroyed) return;
      this.navigationRoute = route;
      this.routeCumulativeDistances = cumulativeRouteDistances(route.coordinates);
      this.drawNavigationRoute(route);
      this.announcedThresholds.clear();
      this.updateNavigationMetrics(position, false);
      this.markUpcomingThresholdsPassed();
      this.navigationStatus = 'navigating';
      await this.locationService.watchNavigationPosition(
        (nextPosition) => this.zone.run(() => this.handleNavigationPosition(nextPosition)),
        (error) => this.zone.run(() => this.handleNavigationLocationError(error)),
      );
      if (this.destroyed) return;
      const distance = formatDistance(route.distance);
      this.voiceService.speak(`Navigation started. Your destination is ${distance} away. ${this.currentVoiceInstruction()}`);
      this.voiceSupported = this.voiceService.supported;
    } catch (error) {
      await this.locationService.stopWatchingNavigationPosition().catch((cleanupError: unknown) => {
        console.error('Navigation GPS watcher cleanup failed.', cleanupError);
      });
      this.removeNavigationOverlays();
      this.navigationRoute = undefined;
      this.routeCumulativeDistances = [];
      this.navigationFacility = undefined;
      this.navigationStatus = 'idle';
      this.voiceService.stop();
      this.navigationError = error instanceof Error ? error.message : 'Navigation could not be started. Please try again.';
    } finally {
      this.navigationLoading = false;
      if (!this.destroyed) this.changeDetector.markForCheck();
    }
  }

  async pauseNavigation(): Promise<void> {
    if (this.destroyed || this.navigationStatus !== 'navigating') return;
    this.navigationStatus = 'paused';
    this.voiceService.stop();
    try {
      await this.locationService.stopWatchingNavigationPosition();
    } catch (error) {
      this.navigationError = error instanceof Error ? error.message : 'GPS tracking could not be paused.';
    }
    this.changeDetector.markForCheck();
  }

  async resumeNavigation(): Promise<void> {
    if (this.navigationStatus !== 'paused' || !this.navigationRoute || !this.navigationFacility) return;
    this.navigationError = '';
    this.navigationLoading = true;
    try {
      const position = await this.locationService.getNavigationPosition();
      if (this.destroyed) return;
      this.navigationPosition = position;
      this.updateNavigationLocationMarker(position);
      this.navigationStatus = 'navigating';
      await this.locationService.watchNavigationPosition(
        (nextPosition) => this.zone.run(() => this.handleNavigationPosition(nextPosition)),
        (error) => this.zone.run(() => this.handleNavigationLocationError(error)),
      );
      if (this.destroyed) return;
      this.updateNavigationMetrics(position, false);
      this.markUpcomingThresholdsPassed();
      this.voiceService.speak(`Navigation resumed. ${this.currentVoiceInstruction()}`);
      this.maybeReroute(position);
    } catch (error) {
      this.navigationStatus = 'paused';
      this.navigationError = error instanceof Error ? error.message : 'Navigation could not be resumed. Check GPS and try again.';
    } finally {
      this.navigationLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  async endNavigation(): Promise<void> {
    this.voiceService.stop();
    try {
      await this.locationService.stopWatchingNavigationPosition();
    } catch (error) {
      this.navigationError = error instanceof Error ? error.message : 'GPS tracking could not be stopped.';
    }
    this.navigationStatus = 'idle';
    this.navigationRoute = undefined;
    this.routeCumulativeDistances = [];
    this.navigationFacility = undefined;
    this.navigationPosition = undefined;
    this.navigationError = '';
    this.announcedThresholds.clear();
    this.removeNavigationOverlays();
    this.changeDetector.markForCheck();
  }

  toggleVoice(): void {
    this.voiceMuted = this.voiceService.toggleMute();
  }

  repeatInstruction(): void {
    if (this.currentInstruction) this.voiceService.repeat(this.currentVoiceInstruction());
  }

  closeArrival(): void {
    void this.endNavigation();
  }

  private selectDestinationFromUrl(): void {
    const destinationId = this.route.snapshot.queryParamMap.get('destination');
    if (!destinationId) return;
    const facility = [...this.facilities, ...this.openMapFacilities]
      .find((item) => item.id === destinationId);
    if (facility) this.selectFacility(facility);
  }

  private updateNavigationLocationMarker(position: Position): void {
    const point: LeafletTypes.LatLngExpression = [position.coords.latitude, position.coords.longitude];
    if (this.locationMarker) {
      this.locationMarker.setLatLng(point);
      this.locationMarker.setStyle({
        radius: 9, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1,
      });
      return;
    }
    if (!this.map) return;
    this.locationMarker = L.circleMarker(point, {
      radius: 9, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1,
    }).addTo(this.map).bindPopup('Your current location');
  }

  private drawNavigationRoute(route: NavigationRoute): void {
    if (!this.map || !this.navigationFacility) return;
    this.routeLayer?.remove();
    this.destinationMarker?.remove();
    this.routeLayer = L.polyline(
      route.coordinates.map(([longitude, latitude]) => [latitude, longitude] as LeafletTypes.LatLngExpression),
      { color: '#1769d2', weight: 6, opacity: 0.88, lineCap: 'round', lineJoin: 'round' },
    ).addTo(this.map);
    const latitude = this.navigationFacility.latitude;
    const longitude = this.navigationFacility.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
    this.destinationMarker = L.marker([latitude, longitude], {
      title: this.facilityName(this.navigationFacility),
      icon: L.divIcon({
        className: 'navigation-destination-marker',
        html: '<span aria-hidden="true"></span>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    }).addTo(this.map).bindPopup(this.facilityName(this.navigationFacility));
    this.map.fitBounds(this.routeLayer.getBounds(), { padding: [35, 35], maxZoom: 15 });
  }

  private removeNavigationOverlays(): void {
    this.routeLayer?.remove();
    this.destinationMarker?.remove();
    this.routeLayer = undefined;
    this.destinationMarker = undefined;
  }

  private handleNavigationPosition(position: Position): void {
    if (this.destroyed || this.navigationStatus !== 'navigating' || !this.navigationRoute || !this.navigationFacility) return;
    const { latitude, longitude, accuracy } = position.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.navigationPosition = position;
    this.updateNavigationLocationMarker(position);
    this.updateNavigationMetrics(position);

    const distanceToDestination = distanceBetween(
      { latitude, longitude },
      { latitude: this.navigationFacility.latitude!, longitude: this.navigationFacility.longitude! },
    );
    if (isArrivalPosition(distanceToDestination, accuracy)) {
      void this.arriveAtDestination();
      this.changeDetector.markForCheck();
      return;
    }
    this.maybeReroute(position);
    this.changeDetector.markForCheck();
  }

  private updateNavigationMetrics(position: Position, allowAnnouncements = true): void {
    const route = this.navigationRoute;
    if (!route) return;
    const nearest = nearestRoutePosition(
      { latitude: position.coords.latitude, longitude: position.coords.longitude },
      route.coordinates,
      this.routeCumulativeDistances,
    );
    this.routeProgressMeters = geometryProgressToRouteMeters(
      nearest.progressMeters, route, this.routeCumulativeDistances,
    );
    this.remainingDistanceMeters = Math.max(0, route.distance - this.routeProgressMeters);
    this.remainingDurationSeconds = route.distance > 0
      ? route.duration * this.remainingDistanceMeters / route.distance
      : 0;

    let nextStepIndex = -1;
    for (let index = 1; index < route.steps.length; index += 1) {
      const stepDistance = routeStepDistance(route, index, this.routeCumulativeDistances) - this.routeProgressMeters;
      if (stepDistance >= -25) {
        nextStepIndex = index;
        break;
      }
    }
    if (nextStepIndex < 0) {
      this.nextStepIndex = -1;
      this.currentInstruction = route.steps.at(-1)?.instruction ?? 'Continue to your destination.';
      this.turnDistanceMeters = this.remainingDistanceMeters;
      return;
    }

    this.nextStepIndex = nextStepIndex;
    this.currentInstruction = route.steps[nextStepIndex]!.instruction;
    this.turnDistanceMeters = Math.max(
      0, routeStepDistance(route, nextStepIndex, this.routeCumulativeDistances) - this.routeProgressMeters,
    );
    if (allowAnnouncements && this.navigationStatus === 'navigating') {
      this.announceManeuver(nextStepIndex, this.turnDistanceMeters);
    }
  }

  private markUpcomingThresholdsPassed(): void {
    if (this.nextStepIndex < 1) return;
    for (const threshold of [25, 100, 500]) {
      if (this.turnDistanceMeters <= threshold) {
        this.announcedThresholds.add(`${this.nextStepIndex}:${threshold}`);
      }
    }
  }

  private currentVoiceInstruction(): string {
    return this.turnDistanceMeters > 0
      ? `${this.currentInstruction} in ${formatDistance(this.turnDistanceMeters)}.`
      : this.currentInstruction;
  }

  private announceManeuver(stepIndex: number, distanceMeters: number): void {
    const step = this.navigationRoute?.steps[stepIndex];
    if (!step) return;
    const thresholds = [25, 100, 500];
    const threshold = thresholds.find((value) => distanceMeters <= value
      && !this.announcedThresholds.has(`${stepIndex}:${value}`));
    if (threshold === undefined) return;
    this.announcedThresholds.add(`${stepIndex}:${threshold}`);
    const announcement = threshold === 25
      ? step.instruction
      : `${step.instruction} in ${threshold} meters.`;
    this.voiceService.speak(announcement);
  }

  private maybeReroute(position: Position): void {
    const route = this.navigationRoute;
    const facility = this.navigationFacility;
    if (!route || !facility || this.rerouting || this.navigationStatus !== 'navigating') return;
    const nearest = nearestRoutePosition(
      { latitude: position.coords.latitude, longitude: position.coords.longitude },
      route.coordinates,
      this.routeCumulativeDistances,
    );
    if (!shouldReroute(nearest.distanceMeters, position.coords.accuracy, Date.now() - this.lastRerouteAt)) return;
    void this.rerouteFrom(position, facility);
  }

  private async rerouteFrom(position: Position, facility: Facility): Promise<void> {
    this.rerouting = true;
    this.rerouteLoading = true;
    this.lastRerouteAt = Date.now();
    try {
      const route = await this.routingService.getDrivingRoute({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }, {
        latitude: facility.latitude!,
        longitude: facility.longitude!,
      });
      if (this.navigationStatus !== 'navigating' || this.navigationFacility?.id !== facility.id) return;
      this.navigationRoute = route;
      this.routeCumulativeDistances = cumulativeRouteDistances(route.coordinates);
      this.announcedThresholds.clear();
      this.drawNavigationRoute(route);
      this.updateNavigationMetrics(position, false);
      this.markUpcomingThresholdsPassed();
      this.voiceService.speak(`Route updated. ${this.currentVoiceInstruction()}`);
      this.navigationError = '';
    } catch (error) {
      console.error('The route could not be recalculated.', error);
      this.navigationError = error instanceof Error
        ? `Route update failed: ${error.message}`
        : 'Route update failed. You can continue on the current route or try again later.';
    } finally {
      this.rerouting = false;
      this.rerouteLoading = false;
      this.changeDetector.markForCheck();
    }
  }

  private async arriveAtDestination(): Promise<void> {
    if (this.navigationStatus !== 'navigating') return;
    this.navigationStatus = 'arrived';
    this.currentInstruction = 'You have arrived at your destination.';
    this.turnDistanceMeters = 0;
    this.remainingDistanceMeters = 0;
    this.remainingDurationSeconds = 0;
    try {
      await this.locationService.stopWatchingNavigationPosition();
    } catch (error) {
      console.error('The GPS watcher could not be stopped after arrival.', error);
    }
    if (this.destroyed) return;
    this.voiceService.speak('You have arrived at your destination.');
    this.changeDetector.markForCheck();
  }

  private handleNavigationLocationError(error: unknown): void {
    console.error('Navigation GPS tracking failed.', error);
    if (this.navigationStatus !== 'navigating') return;
    this.navigationStatus = 'paused';
    this.voiceService.stop();
    this.navigationError = 'GPS tracking stopped. Check location permission and GPS, then resume navigation.';
    void this.locationService.stopWatchingNavigationPosition().catch((cleanupError: unknown) => {
      console.error('Navigation GPS watcher cleanup failed.', cleanupError);
    });
    this.changeDetector.markForCheck();
  }

  categoryIcon(category: FacilityCategory | 'all'): string {
    return category === 'all' ? '' : categoryIcons[category];
  }

  facilityName(facility: Facility): string {
    return facility.name?.trim() || facility.sourceData?.originalName?.trim()
      || `Unnamed ${categoryNames[facility.category].toLocaleLowerCase()}`;
  }

  facilityAddress(facility: Facility): string {
    return fullFacilityAddress(facility);
  }

  thumbnailUrl(facility: Facility): string | undefined {
    const url = this.facilityPhotos(facility)[0];
    return cloudinaryImageUrl(url, 160);
  }

  facilityPhotoUrls(facility: Facility): string[] {
    return this.facilityPhotos(facility).map((url) => cloudinaryImageUrl(url, 480) ?? url);
  }

  phoneHref(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const phone = value.trim();
    const digits = phone.replace(/\D/g, '');
    if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) return undefined;
    return `tel:${phone.replace(/[^\d+]/g, '')}`;
  }

  operatingHourRows(facility: Facility): Array<{ day: string; hours: string }> {
    const dayNames: Record<string, string> = {
      monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
      friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
    };
    const rows = Object.entries(facility.operatingHours ?? {}).flatMap(([day, hours]) => {
      if (!hours) return [];
      const label = dayNames[day] ?? `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
      if (hours.closed) return [{ day: label, hours: 'Closed' }];
      if (hours.open && hours.close) return [{ day: label, hours: `${hours.open} – ${hours.close}` }];
      return [];
    });
    const openingHours = facility.openingHoursText || facility.sourceData?.originalOpeningHours;
    return rows.length || !openingHours ? rows : [{ day: 'Hours', hours: openingHours }];
  }

  facilityContactNumber(facility: Facility): string | undefined {
    return facility.contactNumber || facility.sourceData?.originalContactNumber;
  }

  facilityServices(facility: Facility): string[] {
    return facility.services?.length
      ? facility.services
      : facility.sourceData?.originalServices ?? [];
  }

  websiteHref(value: string | undefined): string | undefined {
    return safeWebsiteUrl(value);
  }

  setSearch(event: Event): void {
    this.searchText = (event.target as HTMLInputElement).value;
    if (this.selectedFacility && !this.matchesFacility(this.selectedFacility)) this.selectedFacility = null;
    this.renderFacilityMarkers();
    this.renderOpenMapMarkers();
  }

  setCategoryFilter(value: FacilityCategory | 'all'): void {
    this.categoryFilter = value;
    if (this.selectedFacility && !this.matchesFacility(this.selectedFacility)) this.selectedFacility = null;
    this.renderFacilityMarkers();
    this.renderOpenMapMarkers();
  }

  retryOpenMapSearch(): void {
    this.lastOpenMapQuery = '';
    this.scheduleOpenMapRefresh(true);
  }

  private renderFacilityMarkers(): void {
    if (!this.map || !this.markerCluster) return;
    const candidates = this.facilities.filter((item) => item.isActive && !item.isSample && this.matchesFacility(item));
    const result = this.syncFacilityMarkers(candidates, this.facilityMarkers, this.facilityMarkerSignatures);
    const bounds = this.map.getBounds();
    const facilitiesInView = candidates.filter((facility) => {
      const coordinates = facilityCoordinates(facility);
      return coordinates !== null && bounds.contains([coordinates.latitude, coordinates.longitude]);
    }).length;
    const diagnostics = {
      source: 'firestore',
      facilitiesPassingFilters: candidates.length,
      facilitiesInCurrentBounds: facilitiesInView,
      invalidCoordinates: result.invalidCoordinates,
      likelyReversedCoordinates: result.likelyReversedCoordinates,
      invalidCategories: result.invalidCategories,
      markersCreated: result.created,
      markersAddedToCluster: result.added,
      markersUpdated: result.updated,
      markersRemoved: result.removed,
      clusterAttachedToMap: this.map.hasLayer(this.markerCluster),
      totalMarkersInCluster: this.markerCluster.getLayers().length,
      zoom: this.map.getZoom(),
      center: this.map.getCenter(),
      bounds: bounds.toBBoxString(),
    };
    const diagnosticsKey = JSON.stringify(diagnostics);
    if (diagnosticsKey !== this.lastMarkerDiagnostics) {
      console.info('[CareFinder map] Facility marker batch rendered', diagnostics);
      this.lastMarkerDiagnostics = diagnosticsKey;
    }
  }

  private syncFacilityMarkers(
    facilities: Facility[],
    markersById: Map<string, LeafletTypes.Marker>,
    signaturesById: Map<string, string>,
  ): {
    created: number;
    added: number;
    updated: number;
    removed: number;
    invalidCoordinates: number;
    likelyReversedCoordinates: number;
    invalidCategories: number;
  } {
    if (!this.map || !this.markerCluster) {
      return {
        created: 0, added: 0, updated: 0, removed: 0,
        invalidCoordinates: 0, likelyReversedCoordinates: 0, invalidCategories: 0,
      };
    }

    const processedIds = new Set<string>();
    const seenIds = new Set<string>();
    const pendingAdd: LeafletTypes.Marker[] = [];
    let created = 0;
    let added = 0;
    let updated = 0;
    let invalidCoordinates = 0;
    let likelyReversedCoordinates = 0;
    let invalidCategories = 0;
    for (const facility of facilities) {
      if (processedIds.has(facility.id)) continue;
      processedIds.add(facility.id);
      if (!isFacilityCategory(facility.category)) {
        invalidCategories += 1;
        continue;
      }

      const coordinates = facilityCoordinates(facility);
      if (!coordinates) {
        invalidCoordinates += 1;
        if (hasLikelyReversedCoordinates(facility)) likelyReversedCoordinates += 1;
        continue;
      }

      seenIds.add(facility.id);
      const position: LeafletTypes.LatLngExpression = [coordinates.latitude, coordinates.longitude];
      const signature = facilityMarkerSignature(facility, coordinates.latitude, coordinates.longitude);
      let marker = markersById.get(facility.id);
      if (!marker) {
        marker = L.marker(position, {
          icon: categoryMarkerIcon(facility.category),
          pane: 'markerPane',
          keyboard: true,
          title: this.facilityName(facility),
        }).bindPopup(facilityPopup(facility), { maxWidth: 340, minWidth: 250 });
        marker.on('click', () => this.selectFacility(facility));
        markersById.set(facility.id, marker);
        pendingAdd.push(marker);
        signaturesById.set(facility.id, signature);
        created += 1;
        continue;
      }

      if (signaturesById.get(facility.id) !== signature) {
        this.markerCluster.removeLayer(marker);
        marker.setLatLng(position);
        marker.setIcon(categoryMarkerIcon(facility.category));
        marker.setPopupContent(facilityPopup(facility));
        marker.options.title = this.facilityName(facility);
        marker.off('click');
        marker.on('click', () => this.selectFacility(facility));
        pendingAdd.push(marker);
        signaturesById.set(facility.id, signature);
        updated += 1;
      }
    }

    let removed = 0;
    for (const [id, marker] of markersById) {
      if (seenIds.has(id)) continue;
      this.markerCluster.removeLayer(marker);
      markersById.delete(id);
      signaturesById.delete(id);
      removed += 1;
    }

    if (pendingAdd.length) {
      this.markerCluster.addLayers(pendingAdd);
      added = pendingAdd.filter((marker) => this.markerCluster?.hasLayer(marker)).length;
    }

    return {
      created, added, updated, removed,
      invalidCoordinates, likelyReversedCoordinates, invalidCategories,
    };
  }

  private matchesFacility(facility: Facility, query = this.searchText.trim().toLocaleLowerCase()): boolean {
    if (this.categoryFilter !== 'all' && facility.category !== this.categoryFilter) return false;
    if (!query) return true;
    return `${this.facilityName(facility)} ${this.facilityAddress(facility)}`.toLocaleLowerCase().includes(query);
  }

  private facilityPhotos(facility: Facility): string[] {
    return [...new Set([
      facility.imageUrl,
      ...(facility.photos ?? []).map((photo) => photo.secureUrl),
      ...(facility.imageUrls ?? []),
    ].filter((url): url is string => Boolean(url)))];
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
      if (this.selectedFacility?.source === 'openstreetmap'
        && !this.openMapFacilities.some((facility) => facility.id === this.selectedFacility?.id)) {
        this.selectedFacility = null;
      }
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
    if (!this.map || !this.markerCluster) return;
    const candidates = this.openMapFacilities.filter((facility) => this.matchesFacility(facility));
    const result = this.syncFacilityMarkers(candidates, this.openMapMarkerById, this.openMapMarkerSignatures);
    const diagnostics = {
      source: 'openstreetmap',
      facilitiesPassingFilters: candidates.length,
      invalidCoordinates: result.invalidCoordinates,
      invalidCategories: result.invalidCategories,
      markersCreated: result.created,
      markersAddedToCluster: result.added,
      markersUpdated: result.updated,
      markersRemoved: result.removed,
      clusterAttachedToMap: this.map.hasLayer(this.markerCluster),
      totalMarkersInCluster: this.markerCluster.getLayers().length,
      zoom: this.map.getZoom(),
      center: this.map.getCenter(),
    };
    const diagnosticsKey = JSON.stringify(diagnostics);
    if (diagnosticsKey !== this.lastMarkerDiagnostics) {
      console.info('[CareFinder map] OpenStreetMap marker batch rendered', diagnostics);
      this.lastMarkerDiagnostics = diagnosticsKey;
    }
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
  const address = tags['addr:full'] || [street, city].filter(Boolean).join(', ') || city;
  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags['name'] ?? tags['name:en'] ?? tags['operator'] ?? `Unnamed ${categoryNames[category].toLocaleLowerCase()}`,
    category,
    address,
    city: city || undefined,
    province: tags['addr:state'],
    contactNumber: tags['contact:phone'] ?? tags['phone'],
    website: tags['contact:website'] ?? tags['website'],
    description: tags['description'],
    openingHoursText: tags['opening_hours'],
    services: tags['healthcare:speciality']?.split(';').map((service) => service.trim()).filter(Boolean),
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

function isFacilityCategory(category: unknown): category is FacilityCategory {
  return typeof category === 'string' && Object.prototype.hasOwnProperty.call(categoryMarkerColors, category);
}

function summarizeCoordinateFields(facilities: readonly Facility[]): Record<string, {
  present: number;
  numbers: number;
  strings: number;
  nulls: number;
  other: number;
}> {
  const summarize = (field: string) => {
    const counts = { present: 0, numbers: 0, strings: 0, nulls: 0, other: 0 };
    for (const facility of facilities) {
      const value: unknown = Reflect.get(facility, field);
      if (value === undefined) continue;
      counts.present += 1;
      if (value === null) counts.nulls += 1;
      else if (typeof value === 'number') counts.numbers += 1;
      else if (typeof value === 'string') counts.strings += 1;
      else counts.other += 1;
    }
    return counts;
  };

  return {
    latitude: summarize('latitude'),
    longitude: summarize('longitude'),
    lat: summarize('lat'),
    lng: summarize('lng'),
  };
}

function hasLikelyReversedCoordinates(facility: Facility): boolean {
  const latitude = Number(facility.latitude);
  const longitude = Number(facility.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) > 90 && Math.abs(latitude) <= 180
    && Math.abs(longitude) <= 90;
}

function facilityMarkerSignature(facility: Facility, latitude: number, longitude: number): string {
  return JSON.stringify([
    latitude,
    longitude,
    facility.category,
    facility.id,
    facility.name,
    facility.sourceData?.originalName,
    facility.isVerified,
    facility.imageUrl,
    facility.imageUrls,
    facility.photos,
    facility.address,
    facility.sourceData?.originalAddress,
    facility.barangay,
    facility.city,
    facility.province,
    facility.region,
    facility.description,
    facility.contactNumber,
    facility.operatingHours,
    facility.openingHoursText,
    facility.services,
    facility.website,
    facility.source,
  ]);
}

function categoryMarkerIcon(category: Facility['category']): LeafletTypes.DivIcon {
  const color = categoryMarkerColors[category];
  return L.divIcon({
    className: 'facility-marker',
    html: `<span class="facility-marker-glyph facility-marker-${category}" role="img" aria-label="${categoryNames[category]}" style="display:flex;width:34px;height:34px;box-sizing:border-box;align-items:center;justify-content:center;border:2px solid #fff;border-radius:50%;color:#fff;background:${color};box-shadow:0 1px 4px rgba(25,54,72,.35)">${categorySvg(category)}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

function createClusterIcon(cluster: LeafletTypes.MarkerCluster): LeafletTypes.DivIcon {
  const count = cluster.getChildCount();
  const size = count >= 100 ? 'large' : count >= 10 ? 'medium' : 'small';
  const diameter = size === 'large' ? 50 : size === 'medium' ? 44 : 38;
  const background = size === 'large' ? '#155fa9' : size === 'medium' ? '#176dbb' : '#1976d2';
  return L.divIcon({
    className: `facility-cluster facility-cluster-${size}`,
    html: `<span role="img" aria-label="${count} facilities" style="display:flex;width:${diameter}px;height:${diameter}px;box-sizing:border-box;align-items:center;justify-content:center;border:2px solid #fff;border-radius:50%;color:#fff;background:${background};box-shadow:0 2px 6px rgba(25,54,72,.3);font:700 12px/1 Arial,sans-serif">${count}</span>`,
    iconSize: [diameter, diameter],
    iconAnchor: [diameter / 2, diameter / 2],
  });
}

function categorySvg(category: Facility['category']): string {
  const paths: Record<Facility['category'], string> = {
    hospital: '<path d="M7 3h10v18H7z"/><path d="M10 7h4M12 5v4M10 13h4M10 17h4"/>',
    clinic: '<path d="M7 3v5a5 5 0 0 0 10 0V3"/><path d="M7 6H5M17 6h2M12 13v3a3 3 0 0 0 6 0v-1"/><circle cx="18" cy="13" r="1"/>',
    pharmacy: '<path d="M8 4h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8Z"/><path d="m9 11 6-6"/>',
    health_center: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex:0 0 auto">${paths[category]}</svg>`;
}

function facilityPopup(facility: Facility): string {
  const images = [...new Set([
    facility.imageUrl,
    ...(facility.photos ?? []).map((photo) => photo.secureUrl),
    ...(facility.imageUrls ?? []),
  ].filter(
    (url): url is string => Boolean(url),
  ))];
  const gallery = images.length
    ? `<div class="facility-popup-gallery">${images.map((url) =>
      `<img src="${escapeHtml(cloudinaryImageUrl(url, 360) ?? url)}" alt="${escapeHtml(facility.name || facility.sourceData?.originalName || categoryNames[facility.category])}" loading="lazy">`,
    ).join('')}</div>`
    : `<div class="facility-popup-placeholder"><span>${categorySvg(facility.category)}</span><small>${escapeHtml(categoryNames[facility.category])}</small></div>`;
  const address = fullFacilityAddress(facility);
  const contact = facility.contactNumber
    ? `<p><strong>Phone</strong> <a href="tel:${escapeHtml(facility.contactNumber)}">${escapeHtml(facility.contactNumber)}</a></p>`
    : '';
  const hours = popupOperatingHours(facility);
  const services = facility.services?.length
    ? `<p><strong>Services</strong> ${escapeHtml(facility.services.join(', '))}</p>`
    : '';
  const websiteUrl = safeWebsiteUrl(facility.website);
  const website = websiteUrl
    ? `<p><strong>Website</strong> <a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">Visit website</a></p>`
    : '';
  const details = facility.source === 'openstreetmap' || /^osm[-_]/.test(facility.id)
    ? ''
    : `<a class="facility-popup-details" href="/facility/${encodeURIComponent(facility.id)}">View details</a>`;
  const name = facility.name?.trim() || facility.sourceData?.originalName?.trim()
    || `Unnamed ${categoryNames[facility.category].toLocaleLowerCase()}`;
  const verified = facility.isVerified ? '<span class="facility-popup-verified">Verified</span>' : '';
  return `<article class="facility-popup">${gallery}<div class="facility-popup-content">
    <span class="facility-popup-category">${categorySvg(facility.category)} ${escapeHtml(categoryNames[facility.category])}</span>${verified}
    <h3>${escapeHtml(name)}</h3>
    ${address ? `<p><strong>Address</strong> ${escapeHtml(address)}</p>` : ''}
    ${facility.description ? `<p>${escapeHtml(facility.description)}</p>` : ''}
    ${contact}${hours ? `<p><strong>Hours</strong> ${escapeHtml(hours)}</p>` : ''}${services}${website}
    <div class="facility-popup-actions">${details}<a class="facility-popup-directions" href="${escapeHtml(directionsUrl(facility))}" target="_blank" rel="noopener noreferrer">Directions</a></div>
  </div></article>`;
}

function fullFacilityAddress(facility: Facility): string {
  const parts = [facility.address?.trim() || facility.sourceData?.originalAddress?.trim(),
    facility.barangay, facility.city, facility.province, facility.region]
    .filter((part): part is string => Boolean(part?.trim()));
  return [...new Map(parts.map((part) => [part.toLocaleLowerCase(), part])).values()].join(', ');
}

function popupOperatingHours(facility: Facility): string {
  if (!facility.operatingHours) return '';
  return Object.entries(facility.operatingHours).map(([day, hours]) => {
    const label = `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
    if (hours?.closed) return `${label}: closed`;
    return hours?.open && hours.close ? `${label}: ${hours.open}–${hours.close}` : '';
  }).filter(Boolean).join(' · ');
}

function safeWebsiteUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.startsWith('https://') || value.startsWith('http://') ? value : `https://${value}`);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'Unavailable';
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unavailable';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function formatArrivalTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unavailable';
  const arrival = new Date(Date.now() + seconds * 1000);
  if (!Number.isFinite(arrival.getTime())) return 'Unavailable';
  return arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
