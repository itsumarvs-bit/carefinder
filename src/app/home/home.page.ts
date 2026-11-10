import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, IonInfiniteScroll, IonInfiniteScrollContent, IonSearchbar, IonSpinner, ToastController,
} from '@ionic/angular';
import { User } from 'firebase/auth';
import { Observable, Subscription, catchError, firstValueFrom, of, shareReplay, switchMap, tap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { cloudinaryImageUrl } from '../core/cloudinary.service';
import { FavoritesService } from '../core/favorites.service';
import { FacilityService } from '../core/facility.service';
import { FacilityReviewService } from '../core/facility-review.service';
import { LocationService } from '../core/location.service';
import { facilityDistanceKm, facilityOpenStatus } from '../core/facility-utils';
import { Facility, FacilityCategory, categoryLabels } from '../models/facility.model';
import { FacilityReviewSummary } from '../models/facility-review.model';
import { FacilityRatingComponent } from '../shared/facility-rating/facility-rating.component';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    CommonModule, FormsModule, RouterLink, FacilityRatingComponent, IonButton, IonContent, IonIcon, IonInfiniteScroll,
    IonInfiniteScrollContent, IonSearchbar, IonSpinner,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  private readonly facilityService = inject(FacilityService);
  private readonly facilityReviewService = inject(FacilityReviewService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly authService = inject(AuthService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly locationService = inject(LocationService);
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);

  readonly categoryLabels = categoryLabels;
  readonly categories: Array<{ id: FacilityCategory | 'all'; label: string; icon: string }> = [
    { id: 'all', label: 'All services', icon: 'apps-outline' },
    { id: 'hospital', label: 'Hospitals', icon: 'medkit-outline' },
    { id: 'clinic', label: 'Clinics', icon: 'pulse-outline' },
    { id: 'pharmacy', label: 'Pharmacies', icon: 'bandage-outline' },
    { id: 'health_center', label: 'Health centers', icon: 'heart-outline' },
  ];
  readonly isDemo = !this.facilityService.isConfigured;
  readonly user$: Observable<User | null> = this.authService.user$.pipe(shareReplay({ bufferSize: 1, refCount: true }));
  readonly favoriteIds$: Observable<string[]> = this.user$.pipe(
    switchMap((user) => user ? this.favoritesService.watchFavoriteIds() : of([])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  readonly facilities$: Observable<Facility[]> = this.facilityService.watchActiveFacilities().pipe(
    tap(() => {
      this.facilitiesLoaded = true;
    }),
    catchError((error: unknown) => {
      console.error('Facility list could not be loaded.', error);
      this.loadError = 'We could not load healthcare facilities. Check your connection and Firebase setup, then try again.';
      this.facilitiesLoaded = true;
      return of([]);
    }),
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
  readonly reviewSummaries$ = this.facilities$.pipe(
    switchMap((facilities) => this.facilityReviewService.watchSummaries(
      facilities.filter((facility) => facility.isActive && !facility.isSample).map((facility) => facility.id),
    )),
  );

  searchText = '';
  selectedCategory: FacilityCategory | 'all' = 'all';
  visibleItemCount = 10;
  location: GeolocationCoordinates | null = null;
  locationMessage = '';
  loadError = '';
  facilitiesLoaded = false;
  locating = false;
  reviewSummaries = new Map<string, FacilityReviewSummary>();
  reviewSummaryError = '';
  classificationFilter: 'all' | 'public' | 'private' = 'all';
  minimumRating = 0;
  verifiedOnly = false;
  withinDistanceKm = 0;
  twentyFourHoursOnly = false;

  private cachedFacilities?: Facility[];
  private cachedSearchText = '';
  private cachedCategory: FacilityCategory | 'all' = 'all';
  private cachedLocation: GeolocationCoordinates | null = null;
  private cachedFilterKey = '';
  private cachedReviewSummaries?: Map<string, FacilityReviewSummary>;
  private filteredFacilitiesCache: Facility[] = [];
  private reviewSummarySubscription?: Subscription;

  ngOnInit(): void {
    this.reviewSummarySubscription = this.reviewSummaries$.subscribe({
      next: (summaries) => {
        this.reviewSummaries = summaries;
        this.cachedFacilities = undefined;
        this.changeDetector.markForCheck();
      },
      error: (error: unknown) => {
        console.error('Facility rating summaries could not be displayed.', error);
        this.reviewSummaryError = 'Facility ratings could not be loaded.';
        this.changeDetector.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.reviewSummarySubscription?.unsubscribe();
  }

  getVisibleFacilities(facilities: Facility[]): Facility[] {
    return this.getFilteredFacilities(facilities).slice(0, this.visibleItemCount);
  }

  filteredFacilityCount(facilities: Facility[]): number {
    return this.getFilteredFacilities(facilities).length;
  }

  private getFilteredFacilities(facilities: Facility[]): Facility[] {
    const term = this.searchText.trim().toLocaleLowerCase();
    const filterKey = JSON.stringify([
      this.classificationFilter, this.minimumRating, this.verifiedOnly, this.withinDistanceKm, this.twentyFourHoursOnly,
    ]);
    if (this.cachedFacilities === facilities
      && this.cachedSearchText === term
      && this.cachedCategory === this.selectedCategory
      && this.cachedLocation === this.location
      && this.cachedFilterKey === filterKey
      && this.cachedReviewSummaries === this.reviewSummaries) {
      return this.filteredFacilitiesCache;
    }

    const matching = facilities.filter((facility) => {
      const matchesCategory = this.selectedCategory === 'all' || facility.category === this.selectedCategory;
      const matchesClassification = (this.classificationFilter ?? 'all') === 'all'
        || facility.classification === this.classificationFilter;
      const matchesVerified = !(this.verifiedOnly ?? false) || facility.isVerified;
      const matchesRating = (this.reviewSummaries?.get(facility.id)?.averageRating ?? 0) >= (this.minimumRating ?? 0);
      const distance = this.location ? facilityDistanceKm(this.location, facility) : null;
      const matchesDistance = !(this.withinDistanceKm ?? 0)
        || (distance !== null && distance <= this.withinDistanceKm);
      const matchesHours = !(this.twentyFourHoursOnly ?? false) || isVerifiedTwentyFourHours(facility);
      const searchable = [
        facility.name, facility.category.replace('_', ' '), facility.classification,
        facility.address, facility.city, facility.barangay, facility.province,
        ...(facility.services ?? []), ...(facility.specialties ?? []), ...(facility.departments ?? []),
        ...(facility.diagnosticServices ?? []), ...(facility.emergencyServices ?? []),
      ].filter(Boolean).join(' ').toLocaleLowerCase();
      return matchesCategory && matchesClassification && matchesVerified && matchesRating
        && matchesDistance && matchesHours && (!term || searchable.includes(term));
    });
    if (this.location) {
      matching.sort((a, b) =>
        (facilityDistanceKm(this.location!, a) ?? Number.POSITIVE_INFINITY)
        - (facilityDistanceKm(this.location!, b) ?? Number.POSITIVE_INFINITY));
    }

    this.cachedFacilities = facilities;
    this.cachedSearchText = term;
    this.cachedCategory = this.selectedCategory;
    this.cachedLocation = this.location;
    this.cachedFilterKey = filterKey;
    this.cachedReviewSummaries = this.reviewSummaries;
    this.filteredFacilitiesCache = matching;
    return this.filteredFacilitiesCache;
  }

  resetVisibleItemCount(): void {
    this.visibleItemCount = 10;
  }

  selectCategory(category: FacilityCategory | 'all'): void {
    this.selectedCategory = category;
    this.resetVisibleItemCount();
  }

  clearFilters(): void {
    this.searchText = '';
    this.selectedCategory = 'all';
    this.classificationFilter = 'all';
    this.minimumRating = 0;
    this.verifiedOnly = false;
    this.withinDistanceKm = 0;
    this.twentyFourHoursOnly = false;
    this.resetVisibleItemCount();
  }

  async loadMore(event: Event): Promise<void> {
    this.visibleItemCount = Math.min(this.visibleItemCount + 10, this.filteredFacilitiesCache.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const target = event.target;
    if (!target || !('complete' in target) || typeof target.complete !== 'function') {
      throw new Error('The infinite-scroll event target cannot be completed.');
    }
    await target.complete();
  }

  distance(facility: Facility): number | null {
    return this.location ? facilityDistanceKm(this.location, facility) : null;
  }

  status(facility: Facility): string {
    return facilityOpenStatus(facility);
  }

  photoUrl(facility: Facility): string | undefined {
    return cloudinaryImageUrl(facility.imageUrl ?? facility.photos?.[0]?.secureUrl ?? facility.imageUrls?.[0], 600);
  }

  async useMyLocation(): Promise<void> {
    this.locating = true;
    this.locationMessage = '';
    try {
      const position = await this.locationService.getCurrentPosition();
      this.location = position.coords;
      this.locationMessage = 'Showing facilities nearest to your location. Distances are straight-line estimates.';
    } catch (error) {
      this.locationMessage = error instanceof Error ? error.message : 'Could not determine your location.';
    } finally {
      this.locating = false;
      this.changeDetector.markForCheck();
    }
  }

  async toggleFavorite(facility: Facility): Promise<void> {
    const user: User | null = this.authService.currentUser;
    if (!user) {
      await this.router.navigate(['/auth']);
      return;
    }
    try {
      const favoriteIds = await firstValueFrom(this.favoritesService.watchFavoriteIds());
      await this.favoritesService.toggle(facility.id, favoriteIds.includes(facility.id));
    } catch (error) {
      await this.showToast(error instanceof Error ? error.message : 'Could not update favorites.');
    }
  }

  categoryCount(facilities: Facility[], category: FacilityCategory): number {
    return facilities.filter((facility) => facility.category === category).length;
  }

  async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2600, position: 'bottom' });
    await toast.present();
  }

  isTwentyFourHours(facility: Facility): boolean {
    return isVerifiedTwentyFourHours(facility);
  }
}

function isVerifiedTwentyFourHours(facility: Facility): boolean {
  if (!facility.isVerified) return false;
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  return weekdays.every((day) => {
    const hours = facility.operatingHours?.[day];
    return hours?.closed === false && hours.open === '00:00' && hours.close === '23:59';
  });
}
