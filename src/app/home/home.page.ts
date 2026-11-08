import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, IonSearchbar, IonSpinner, ToastController,
} from '@ionic/angular';
import { User } from 'firebase/auth';
import { Observable, catchError, firstValueFrom, of, shareReplay, switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { FavoritesService } from '../core/favorites.service';
import { FacilityService } from '../core/facility.service';
import { LocationService } from '../core/location.service';
import { facilityDistanceKm, facilityOpenStatus } from '../core/facility-utils';
import { Facility, FacilityCategory, categoryLabels } from '../models/facility.model';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    CommonModule, FormsModule, RouterLink, IonButton, IonContent, IonIcon, IonSearchbar, IonSpinner,
  ],
})
export class HomePage {
  private readonly facilityService = inject(FacilityService);
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
    catchError((error: unknown) => {
      console.error('Facility list could not be loaded.', error);
      this.loadError = 'We could not load healthcare facilities. Check your connection and Firebase setup, then try again.';
      return of([]);
    }),
  ).pipe(shareReplay({ bufferSize: 1, refCount: true }));

  searchText = '';
  selectedCategory: FacilityCategory | 'all' = 'all';
  location: GeolocationCoordinates | null = null;
  locationMessage = '';
  loadError = '';
  locating = false;

  getVisibleFacilities(facilities: Facility[]): Facility[] {
    const term = this.searchText.trim().toLocaleLowerCase();
    const matching = facilities.filter((facility) => {
      const matchesCategory = this.selectedCategory === 'all' || facility.category === this.selectedCategory;
      const searchable = [
        facility.name, facility.address, facility.city, facility.barangay, facility.province,
        ...(facility.services ?? []),
      ].filter(Boolean).join(' ').toLocaleLowerCase();
      return matchesCategory && (!term || searchable.includes(term));
    });
    if (!this.location) return matching;
    return matching.sort((a, b) =>
      (facilityDistanceKm(this.location!, a) ?? Number.POSITIVE_INFINITY)
      - (facilityDistanceKm(this.location!, b) ?? Number.POSITIVE_INFINITY));
  }

  distance(facility: Facility): number | null {
    return this.location ? facilityDistanceKm(this.location, facility) : null;
  }

  status(facility: Facility): string {
    return facilityOpenStatus(facility);
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
}
