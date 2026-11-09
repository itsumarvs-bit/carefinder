
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, IonSpinner,
} from '@ionic/angular';
import type { Position } from '@capacitor/geolocation';
import * as L from 'leaflet';
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
import { directionsUrl } from '../../core/facility-utils';
import { Facility, FacilityCategory, categoryLabels } from '../../models/facility.model';

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
  private map?: L.Map;
  private markerCluster?: L.MarkerClusterGroup;
  private markers: L.Marker[] = [];
  private openMapMarkers: L.Marker[] = [];
  private readonly facilityMarkers = new Map<string, L.Marker>();
  private readonly openMapMarkerById = new Map<string, L.Marker>();
  private facilitiesSubscription?: Subscription;
  private openMapRequest?: AbortController;
  private openMapRefreshTimer?: ReturnType<typeof setTimeout>;
  private lastOpenMapQuery = '';
  private destroyed = false;
  private routeLayer?: L.Polyline;
  private destinationMarker?: L.Marker;
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
  private locationMarker?: L.CircleMarker;
  private mobileViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

  get visibleFacilities(): Facility[] {
    return [
      ...this.facilities.filter((facility) =>
        !facility.isSample && typeof facility.latitude === 'number' && typeof facility.longitude === 'number'),
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
        this.facilities = facilities;
        if (this.selectedFacility) {
          this.selectedFacility = [...facilities, ...this.openMapFacilities]
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
    if (!this.mapHost) return;
    this.map = L.map(this.mapHost.nativeElement, { scrollWheelZoom: false }).setView([12.8797, 121.774], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.markerCluster = L.markerClusterGroup({
      maxClusterRadius: (zoom) => zoom < 8 ? 56 : 42,
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 25,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: createClusterIcon,
    }).addTo(this.map);
    this.map.on('moveend', () => this.scheduleOpenMapRefresh());
    this.renderFacilityMarkers();
    this.scheduleOpenMapRefresh();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    const isMobile = window.matchMedia('(max-width: 760px)').matches;
    if (isMobile === this.mobileViewport) return;
    this.mobileViewport = isMobile;
    this.renderFacilityMarkers();
    this.renderOpenMapMarkers();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.navigationStatus = 'idle';
    this.navigationFacility = undefined;
    this.facilitiesSubscription?.unsubscribe();
    if (this.openMapRefreshTimer) clearTimeout(this.openMapRefreshTimer);
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
    if (this.selectedFacility?.id !== facility.id) this.sheetExpanded = false;
    this.selectedFacility = facility;
    if (this.map && typeof facility.latitude === 'number' && typeof facility.longitude === 'number') {
      const marker = this.facilityMarkers.get(facility.id) ?? this.openMapMarkerById.get(facility.id);
      this.map.flyTo([facility.latitude, facility.longitude], Math.max(15, this.map.getZoom()), { duration: 0.35 });
      if (!this.mobileViewport && marker && this.markerCluster) {
        this.markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
      }
    }
    this.changeDetector.markForCheck();
  }

  toggleSheet(): void {
    this.sheetExpanded = !this.sheetExpanded;
  }

  closeFacilitySheet(): void {
    this.selectedFacility = null;
    this.sheetExpanded = false;
    this.map?.closePopup();
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
    return typeof facility.latitude === 'number' && Number.isFinite(facility.latitude)
      && facility.latitude >= -90 && facility.latitude <= 90
      && typeof facility.longitude === 'number' && Number.isFinite(facility.longitude)
      && facility.longitude >= -180 && facility.longitude <= 180;
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
      const position = await this.locationService.getNavigationPosition();
      if (this.destroyed) return;
      this.navigationPosition = position;
      this.updateNavigationLocationMarker(position);
      const destination = {
        latitude: facility.latitude!,
        longitude: facility.longitude!,
      };
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
    const point: L.LatLngExpression = [position.coords.latitude, position.coords.longitude];
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
      route.coordinates.map(([longitude, latitude]) => [latitude, longitude] as L.LatLngExpression),
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
    this.markerCluster.removeLayers(this.markers);
    this.markers = [];
    this.facilityMarkers.clear();
    for (const facility of this.facilities.filter((item) => !item.isSample && this.matchesFacility(item))) {
      if (typeof facility.latitude !== 'number' || typeof facility.longitude !== 'number') continue;
      const marker = L.marker([facility.latitude, facility.longitude], {
        icon: categoryMarkerIcon(facility.category),
        keyboard: true,
        title: this.facilityName(facility),
      });
      if (!this.mobileViewport) marker.bindPopup(facilityPopup(facility), { maxWidth: 340, minWidth: 250 });
      marker.on('click', () => {
        this.selectFacility(facility);
      });
      this.markers.push(marker);
      this.facilityMarkers.set(facility.id, marker);
    }
    this.markerCluster.addLayers(this.markers);
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
    this.markerCluster.removeLayers(this.openMapMarkers);
    this.openMapMarkerById.clear();
    this.openMapMarkers = this.openMapFacilities.filter((facility) => this.matchesFacility(facility)).flatMap((facility) => {
      if (typeof facility.latitude !== 'number' || typeof facility.longitude !== 'number') return [];
      const marker = L.marker([facility.latitude, facility.longitude], {
        icon: categoryMarkerIcon(facility.category),
        keyboard: true,
        title: this.facilityName(facility),
      });
      if (!this.mobileViewport) marker.bindPopup(facilityPopup(facility), { maxWidth: 340, minWidth: 250 });
      marker.on('click', () => {
        this.selectFacility(facility);
      });
      if (!this.mobileViewport && this.selectedFacility?.id === facility.id) marker.openPopup();
      this.openMapMarkerById.set(facility.id, marker);
      return [marker];
    });
    this.markerCluster.addLayers(this.openMapMarkers);
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

function categoryMarkerIcon(category: Facility['category']): L.DivIcon {
  return L.divIcon({
    className: 'facility-marker',
    html: `<span class="facility-marker-glyph facility-marker-${category}" role="img" aria-label="${categoryNames[category]}">${categorySvg(category)}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const size = count >= 100 ? 'large' : count >= 10 ? 'medium' : 'small';
  return L.divIcon({
    className: `facility-cluster facility-cluster-${size}`,
    html: `<span aria-label="${count} facilities">${count}</span>`,
    iconSize: [50, 50],
  });
}

function categorySvg(category: Facility['category']): string {
  const paths: Record<Facility['category'], string> = {
    hospital: '<path d="M7 3h10v18H7z"/><path d="M10 7h4M12 5v4M10 13h4M10 17h4"/>',
    clinic: '<path d="M7 3v5a5 5 0 0 0 10 0V3"/><path d="M7 6H5M17 6h2M12 13v3a3 3 0 0 0 6 0v-1"/><circle cx="18" cy="13" r="1"/>',
    pharmacy: '<path d="M8 4h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8Z"/><path d="m9 11 6-6"/>',
    health_center: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[category]}</svg>`;
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
