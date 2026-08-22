import { describe, expect, it } from 'vitest';
import { contentHash, cosine, normalizeContent } from '../src/search/dedupe.js';

describe('normalizeContent', () => {
  it('folds case, whitespace and trailing punctuation', () => {
    expect(normalizeContent('  GetCheckout   uses  Adyen.  ')).toBe('getcheckout uses adyen');
  });

  it('treats restated punctuation as the same statement', () => {
    expect(contentHash('Stripe handles UAH!')).toBe(contentHash('stripe handles uah'));
  });

  it('keeps genuinely different statements apart', () => {
    expect(contentHash('Stripe handles UAH')).not.toBe(contentHash('Adyen handles UAH'));
  });

  it('normalizes unicode width so pasted text matches typed text', () => {
    expect(normalizeContent('ｓｔｒｉｐｅ')).toBe('stripe');
  });
});

describe('cosine', () => {
  it('is 1 for identical vectors', () => {
    expect(cosine([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('ignores magnitude', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });

  it('returns 0 rather than NaN on mismatched or empty input', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
