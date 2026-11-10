import { DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FacilityReviewSummary } from '../../models/facility-review.model';

@Component({
  selector: 'app-facility-rating',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (summary?.reviewCount) {
      <span class="rating-stars" [attr.aria-label]="summary.averageRating.toFixed(1) + ' out of 5 stars'">
        @for (star of stars; track star) {
          <span [class.filled]="star <= roundedRating">★</span>
        }
      </span>
      <span class="rating-copy">{{ summary.averageRating | number:'1.1-1' }} · {{ summary.reviewCount }} {{ summary.reviewCount === 1 ? 'review' : 'reviews' }}</span>
    } @else {
      <span class="rating-empty">No reviews yet</span>
    }
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; align-items: center; gap: 5px; color: #647985; font-size: 10px; line-height: 1.3; }
    .rating-stars { display: inline-flex; gap: 1px; color: #d3dce0; font-size: 13px; letter-spacing: -.08em; }
    .rating-stars .filled { color: #e8a52a; }
    .rating-copy { white-space: nowrap; }
    .rating-empty { color: #87959d; }
  `],
})
export class FacilityRatingComponent {
  @Input() summary?: FacilityReviewSummary;
  readonly stars = [1, 2, 3, 4, 5];

  get roundedRating(): number {
    return Math.round(this.summary?.averageRating ?? 0);
  }
}
