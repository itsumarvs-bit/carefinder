import { describe, expect, it } from 'vitest';
import { summarizeFacilityReviewRatings, validateFacilityReviewDraft } from './facility-review.service';

describe('validateFacilityReviewDraft', () => {
  it('accepts a valid rating and trims the comment and display name', () => {
    expect(validateFacilityReviewDraft(5, '  Excellent care.  ', '  Alex  ')).toEqual({
      reviewerName: 'Alex',
      comment: 'Excellent care.',
    });
  });

  it('rejects invalid ratings and blank or oversized comments', () => {
    expect(() => validateFacilityReviewDraft(0, 'Review', 'Alex')).toThrow('rating from 1 to 5');
    expect(() => validateFacilityReviewDraft(2.5, 'Review', 'Alex')).toThrow('rating from 1 to 5');
    expect(() => validateFacilityReviewDraft(5, '   ', 'Alex')).toThrow('1 to 1,000 characters');
    expect(() => validateFacilityReviewDraft(5, 'x'.repeat(1001), 'Alex')).toThrow('1 to 1,000 characters');
  });

  it('uses a bounded fallback name when authentication provides no display name', () => {
    expect(validateFacilityReviewDraft(4, 'Good', null).reviewerName).toBe('CareFinder user');
    expect(validateFacilityReviewDraft(4, 'Good', 'x'.repeat(120)).reviewerName).toHaveLength(100);
  });
});

describe('summarizeFacilityReviewRatings', () => {
  it('calculates the average and count using only valid integer ratings', () => {
    expect(summarizeFacilityReviewRatings([5, 3, 0, 6, 2.5, '4'])).toEqual({
      averageRating: 4,
      reviewCount: 2,
    });
  });

  it('returns no summary when there are no valid ratings', () => {
    expect(summarizeFacilityReviewRatings([0, '5'])).toBeNull();
  });
});
