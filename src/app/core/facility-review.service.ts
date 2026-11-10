import { Injectable, inject } from '@angular/core';
import {
  collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { combineLatest, map, Observable, of } from 'rxjs';
import { FacilityReview, FacilityReviewSummary } from '../models/facility-review.model';
import { FirebaseService } from './firebase.service';

@Injectable({ providedIn: 'root' })
export class FacilityReviewService {
  private readonly firebase = inject(FirebaseService);

  watchReviews(facilityId: string): Observable<FacilityReview[]> {
    const firestore = this.firebase.firestore;
    if (!firestore) return of([]);
    return new Observable<FacilityReview[]>((subscriber) => onSnapshot(
      collection(firestore, 'facilities', facilityId, 'reviews'),
      (snapshot) => subscriber.next(snapshot.docs.map((item) => ({
        ...item.data(),
        id: item.id,
      } as FacilityReview)).sort((left, right) =>
        reviewTimestamp(right) - reviewTimestamp(left))),
      (error) => {
        console.error('Facility reviews could not be loaded.', error);
        subscriber.error(error);
      },
    ));
  }

  watchSummaries(facilityIds: readonly string[]): Observable<Map<string, FacilityReviewSummary>> {
    const firestore = this.firebase.firestore;
    if (!firestore) return of(new Map());
    const uniqueIds = [...new Set(facilityIds)];
    if (!uniqueIds.length) return of(new Map());
    return combineLatest(uniqueIds.map((facilityId) => new Observable<FacilityReviewSummary | null>((subscriber) =>
      onSnapshot(
        collection(firestore, 'facilities', facilityId, 'reviews'),
        (snapshot) => subscriber.next(summarizeFacilityReviewRatings(
          snapshot.docs.map((review) => review.get('rating')),
        )),
        (error) => {
          console.error(`Review summary for facility ${facilityId} could not be loaded.`, error);
          subscriber.error(error);
        },
      ),
    ))).pipe(map((summaries) => {
      const result = new Map<string, FacilityReviewSummary>();
      summaries.forEach((summary, index) => {
        if (summary) result.set(uniqueIds[index], summary);
      });
      return result;
    }));
  }

  async createReview(
    facilityId: string,
    reviewer: { uid: string; displayName: string | null },
    rating: number,
    comment: string,
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const validated = validateFacilityReviewDraft(rating, comment, reviewer.displayName);
    await setDoc(doc(firestore, 'facilities', facilityId, 'reviews', reviewer.uid), {
      reviewerId: reviewer.uid,
      reviewerName: validated.reviewerName,
      rating,
      comment: validated.comment,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async updateReview(
    facilityId: string,
    reviewer: { uid: string; displayName: string | null },
    rating: number,
    comment: string,
  ): Promise<void> {
    const firestore = this.requireFirestore();
    const validated = validateFacilityReviewDraft(rating, comment, reviewer.displayName);
    await updateDoc(doc(firestore, 'facilities', facilityId, 'reviews', reviewer.uid), {
      reviewerName: validated.reviewerName,
      rating,
      comment: validated.comment,
      updatedAt: serverTimestamp(),
    });
  }

  async deleteReview(facilityId: string, reviewerId: string): Promise<void> {
    await deleteDoc(doc(this.requireFirestore(), 'facilities', facilityId, 'reviews', reviewerId));
  }

  private requireFirestore() {
    const firestore = this.firebase.firestore;
    if (!firestore) throw new Error('Firebase Firestore is not configured.');
    return firestore;
  }
}

export function validateFacilityReviewDraft(
  rating: number,
  comment: string,
  displayName: string | null,
): { reviewerName: string; comment: string } {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error('Choose a rating from 1 to 5 stars.');
  }
  const trimmedComment = comment.trim();
  if (!trimmedComment || trimmedComment.length > 1000) {
    throw new Error('Write a review of 1 to 1,000 characters.');
  }
  const reviewerName = displayName?.trim() || 'CareFinder user';
  return {
    reviewerName: reviewerName.slice(0, 100),
    comment: trimmedComment,
  };
}

export function summarizeFacilityReviewRatings(ratings: readonly unknown[]): FacilityReviewSummary | null {
  const validRatings = ratings.filter((rating): rating is number =>
    typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5);
  if (!validRatings.length) return null;
  return {
    averageRating: validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length,
    reviewCount: validRatings.length,
  };
}

function reviewTimestamp(review: FacilityReview): number {
  return review.createdAt && typeof review.createdAt.toMillis === 'function'
    ? review.createdAt.toMillis()
    : 0;
}
