import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AlertController, IonButton, IonContent, IonIcon, ToastController,
} from '@ionic/angular';
import { User } from 'firebase/auth';
import { combineLatest, catchError, firstValueFrom, map, of, shareReplay, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { cloudinaryImageUrl } from '../../core/cloudinary.service';
import { FavoritesService } from '../../core/favorites.service';
import { FacilityReviewService } from '../../core/facility-review.service';
import { FacilityService } from '../../core/facility.service';
import { directionsUrl, facilityOpenStatus } from '../../core/facility-utils';
import { Facility, categoryLabels } from '../../models/facility.model';
import { FacilityReview } from '../../models/facility-review.model';
import { FacilityRatingComponent } from '../../shared/facility-rating/facility-rating.component';

@Component({
  selector: 'app-facility-details',
  templateUrl: './facility-details.page.html',
  styleUrls: ['./facility-details.page.scss'],
  imports: [
    CommonModule, FormsModule, RouterLink, FacilityRatingComponent, IonButton, IonContent, IonIcon,
  ],
})
export class FacilityDetailsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly facilities = inject(FacilityService);
  private readonly auth = inject(AuthService);
  private readonly favorites = inject(FavoritesService);
  private readonly facilityReviews = inject(FacilityReviewService);
  private readonly toastController = inject(ToastController);
  private readonly alertController = inject(AlertController);

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
  reviewLoadError = '';
  reviewRating = 0;
  reviewComment = '';
  reviewEditing = false;
  reviewSaving = false;
  reviewError = '';
  readonly reviews$ = this.route.paramMap.pipe(
    switchMap((params) => {
      const facilityId = params.get('id');
      return facilityId
        ? this.facilityReviews.watchReviews(facilityId).pipe(catchError((error: unknown) => {
          console.error('Facility reviews could not be displayed.', error);
          this.reviewLoadError = 'Reviews could not be loaded. Please try again later.';
          return of([]);
        }))
        : of([]);
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  status(facility: Facility): string {
    return facilityOpenStatus(facility);
  }

  photoUrl(facility: Facility): string | undefined {
    return cloudinaryImageUrl(facility.imageUrl ?? facility.photos?.[0]?.secureUrl ?? facility.imageUrls?.[0], 1200);
  }

  directions(facility: Facility): string {
    return directionsUrl(facility);
  }

  fullAddress(facility: Facility): string {
    return [facility.address || facility.sourceData?.originalAddress, facility.barangay, facility.city,
      facility.province, facility.region]
      .filter((part): part is string => Boolean(part?.trim()))
      .filter((part, index, parts) => parts.findIndex((value) =>
        value.toLocaleLowerCase() === part.toLocaleLowerCase()) === index)
      .join(', ') || 'Information not available';
  }

  phoneHref(facility: Facility): string | undefined {
    const phone = facility.contactNumber || facility.sourceData?.originalContactNumber;
    if (!phone) return undefined;
    const value = phone.trim();
    const digits = value.replace(/\D/g, '');
    return /^\+?[\d\s().-]+$/.test(value) && digits.length >= 7 && digits.length <= 15
      ? `tel:${value.replace(/[^\d+]/g, '')}`
      : undefined;
  }

  emailHref(value?: string): string | undefined {
    const email = value?.trim();
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? `mailto:${encodeURIComponent(email)}`
      : undefined;
  }

  websiteHref(facility: Facility): string | undefined {
    const website = facility.website || facility.sourceData?.originalWebsite;
    if (!website?.trim()) return undefined;
    try {
      const url = new URL(website.startsWith('http://') || website.startsWith('https://')
        ? website
        : `https://${website}`);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  verifiedTwentyFourHours(facility: Facility): boolean {
    if (!facility.isVerified) return false;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
    return days.every((day) => {
      const hours = facility.operatingHours?.[day];
      return hours?.closed === false && hours.open === '00:00' && hours.close === '23:59';
    });
  }

  reviewSummary(reviews: readonly FacilityReview[]): { averageRating: number; reviewCount: number } {
    const total = reviews.reduce((sum, review) => sum + review.rating, 0);
    return { averageRating: reviews.length ? total / reviews.length : 0, reviewCount: reviews.length };
  }

  currentUserReview(reviews: readonly FacilityReview[]): FacilityReview | undefined {
    const userId = this.auth.currentUser?.uid;
    return userId ? reviews.find((review) => review.reviewerId === userId) : undefined;
  }

  reviewDate(review: FacilityReview): Date {
    return review.createdAt.toDate();
  }

  facilityDate(value?: Facility['updatedAt']): Date | undefined {
    return value?.toDate();
  }

  editReview(review: FacilityReview): void {
    this.reviewRating = review.rating;
    this.reviewComment = review.comment;
    this.reviewEditing = true;
    this.reviewError = '';
  }

  async saveReview(facility: Facility, reviews: readonly FacilityReview[]): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      await this.router.navigate(['/auth']);
      return;
    }
    if (!Number.isInteger(this.reviewRating) || this.reviewRating < 1 || this.reviewRating > 5
      || !this.reviewComment.trim() || this.reviewComment.trim().length > 1000) {
      this.reviewError = 'Select 1–5 stars and write a review of 1–1,000 characters.';
      return;
    }
    this.reviewSaving = true;
    this.reviewError = '';
    try {
      const existing = reviews.find((review) => review.reviewerId === user.uid);
      if (existing) {
        await this.facilityReviews.updateReview(facility.id, user, this.reviewRating, this.reviewComment);
      } else {
        await this.facilityReviews.createReview(facility.id, user, this.reviewRating, this.reviewComment);
      }
      this.reviewEditing = false;
      this.reviewRating = 0;
      this.reviewComment = '';
      await this.notify(existing ? 'Your review was updated.' : 'Your review was submitted.');
    } catch (error) {
      this.reviewError = error instanceof Error ? error.message : 'Your review could not be saved.';
    } finally {
      this.reviewSaving = false;
    }
  }

  async deleteReview(facility: Facility, reviews: readonly FacilityReview[]): Promise<void> {
    const user = this.auth.currentUser;
    const review = user && reviews.find((item) => item.reviewerId === user.uid);
    if (!user || !review) return;
    const alert = await this.alertController.create({
      header: 'Delete your review?',
      message: 'This removes your rating and comment from this facility.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive' },
      ],
    });
    await alert.present();
    if ((await alert.onDidDismiss()).role !== 'destructive') return;
    try {
      await this.facilityReviews.deleteReview(facility.id, user.uid);
      this.reviewEditing = false;
      this.reviewRating = 0;
      this.reviewComment = '';
      await this.notify('Your review was deleted.');
    } catch (error) {
      this.reviewError = error instanceof Error ? error.message : 'Your review could not be deleted.';
    }
  }

  cancelReviewEdit(): void {
    this.reviewEditing = false;
    this.reviewRating = 0;
    this.reviewComment = '';
    this.reviewError = '';
  }

  hasValidCoordinates(facility: Facility): boolean {
    return typeof facility.latitude === 'number' && Number.isFinite(facility.latitude)
      && facility.latitude >= -90 && facility.latitude <= 90
      && typeof facility.longitude === 'number' && Number.isFinite(facility.longitude)
      && facility.longitude >= -180 && facility.longitude <= 180;
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

  private async notify(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2400, position: 'bottom' });
    await toast.present();
  }
}
