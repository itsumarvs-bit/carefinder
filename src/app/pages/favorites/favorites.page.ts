import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton, IonContent, IonIcon, ToastController,
} from '@ionic/angular';
import { combineLatest, map, shareReplay, switchMap } from 'rxjs';
import { FavoritesService } from '../../core/favorites.service';
import { FacilityReviewService } from '../../core/facility-review.service';
import { FacilityService } from '../../core/facility.service';
import { FacilityRatingComponent } from '../../shared/facility-rating/facility-rating.component';

@Component({
  selector: 'app-favorites',
  templateUrl: './favorites.page.html',
  styleUrls: ['./favorites.page.scss'],
  imports: [
    CommonModule, RouterLink, FacilityRatingComponent, IonButton, IonContent, IonIcon,
  ],
})
export class FavoritesPage {
  private readonly facilities = inject(FacilityService);
  private readonly facilityReviewService = inject(FacilityReviewService);
  private readonly favorites = inject(FavoritesService);
  private readonly toastController = inject(ToastController);
  readonly saved$ = combineLatest([this.facilities.watchActiveFacilities(), this.favorites.watchFavoriteIds()]).pipe(
    map(([facilities, ids]) => facilities.filter((facility) => ids.includes(facility.id))),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  readonly reviewSummaries$ = this.saved$.pipe(
    switchMap((facilities) => this.facilityReviewService.watchSummaries(facilities.map((facility) => facility.id))),
  );

  async remove(id: string): Promise<void> {
    try {
      await this.favorites.toggle(id, true);
    } catch (error) {
      const toast = await this.toastController.create({ message: error instanceof Error ? error.message : 'Could not remove favorite.', duration: 2500 });
      await toast.present();
    }
  }
}
