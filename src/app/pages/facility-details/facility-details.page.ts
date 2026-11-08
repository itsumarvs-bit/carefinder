import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, ToastController,
} from '@ionic/angular';
import { User } from 'firebase/auth';
import { combineLatest, firstValueFrom, map, of, shareReplay, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { FavoritesService } from '../../core/favorites.service';
import { FacilityService } from '../../core/facility.service';
import { directionsUrl, facilityOpenStatus } from '../../core/facility-utils';
import { Facility, categoryLabels } from '../../models/facility.model';

@Component({
  selector: 'app-facility-details',
  templateUrl: './facility-details.page.html',
  styleUrls: ['./facility-details.page.scss'],
  imports: [
    CommonModule, RouterLink, IonButton, IonContent, IonIcon,
  ],
})
export class FacilityDetailsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly facilities = inject(FacilityService);
  private readonly auth = inject(AuthService);
  private readonly favorites = inject(FavoritesService);
  private readonly toastController = inject(ToastController);

  readonly categoryLabels = categoryLabels;
  readonly facility$ = combineLatest([this.route.paramMap, this.facilities.watchActiveFacilities()]).pipe(
    map(([params, items]) => items.find((item) => item.id === params.get('id')) ?? null),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  readonly user$ = this.auth.user$.pipe(shareReplay({ bufferSize: 1, refCount: true }));
  readonly favoriteIds$ = this.user$.pipe(
    switchMap((user) => user ? this.favorites.watchFavoriteIds() : of([])),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  status(facility: Facility): string {
    return facilityOpenStatus(facility);
  }

  directions(facility: Facility): string {
    return directionsUrl(facility);
  }

  days(facility: Facility): Array<{ label: string; value: string }> {
    const labels: Array<[string, string]> = [
      ['Monday', 'monday'], ['Tuesday', 'tuesday'], ['Wednesday', 'wednesday'],
      ['Thursday', 'thursday'], ['Friday', 'friday'], ['Saturday', 'saturday'], ['Sunday', 'sunday'],
    ];
    return labels.map(([label, key]) => {
      const day = facility.operatingHours?.[key as keyof NonNullable<Facility['operatingHours']>];
      const value = !day || day.closed === undefined
        ? 'Hours unavailable'
        : day.closed ? 'Closed' : day.open && day.close ? `${day.open} – ${day.close}` : 'Hours unavailable';
      return { label, value };
    });
  }

  async save(facility: Facility): Promise<void> {
    const user: User | null = this.auth.currentUser;
    if (!user) {
      await this.router.navigate(['/auth']);
      return;
    }
    try {
      const favoriteIds = await firstValueFrom(this.favorites.watchFavoriteIds());
      await this.favorites.toggle(facility.id, favoriteIds.includes(facility.id));
    } catch (error) {
      const toast = await this.toastController.create({
        message: error instanceof Error ? error.message : 'Could not update favorites.',
        duration: 2500, position: 'bottom',
      });
      await toast.present();
    }
  }
}
