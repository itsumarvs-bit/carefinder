import type { Timestamp } from 'firebase/firestore';

export interface FacilityReview {
  id: string;
  reviewerId: string;
  reviewerName: string;
  rating: number;
  comment: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FacilityReviewSummary {
  averageRating: number;
  reviewCount: number;
}
