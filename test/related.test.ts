import { describe, expect, it } from 'vitest';
import { selectRelated, type Candidate } from '../src/core/related.js';

/** Unit vector at `deg` from the x-axis — cos(deg) is exactly the similarity. */
const at = (id: string, deg: number): Candidate => ({
  id,
  embedding: [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)],
});

const QUERY = [1, 0];

describe('selectRelated', () => {
  it('keeps neighbours at or above the threshold', () => {
    // cos(30°) ≈ 0.866, cos(60°) = 0.5
    const picked = selectRelated([at('near', 30), at('far', 60)], QUERY, 'self', 0.75, 5);
    expect(picked).toEqual(['near']);
  });

  it('is inclusive at exactly the threshold', () => {
    const picked = selectRelated([at('exact', 60)], QUERY, 'self', 0.5, 5);
    expect(picked).toEqual(['exact']);
  });

  it('never links a record to itself', () => {
    expect(selectRelated([at('self', 0)], QUERY, 'self', 0.75, 5)).toEqual([]);
  });

  it('orders by similarity, closest first', () => {
    const picked = selectRelated([at('c', 40), at('a', 10), at('b', 25)], QUERY, 'self', 0.5, 5);
    expect(picked).toEqual(['a', 'b', 'c']);
  });

  it('caps at max, keeping the closest', () => {
    const picked = selectRelated([at('a', 5), at('b', 10), at('c', 15), at('d', 20)], QUERY, 'self', 0.5, 2);
    expect(picked).toEqual(['a', 'b']);
  });

  it('skips candidates with no stored vector rather than scoring them as 0', () => {
    const picked = selectRelated(
      [{ id: 'novec' }, { id: 'empty', embedding: [] }, at('good', 10)],
      QUERY,
      'self',
      0.75,
      5,
    );
    expect(picked).toEqual(['good']);
  });

  it('returns nothing when everything is too distant', () => {
    expect(selectRelated([at('a', 80), at('b', 89)], QUERY, 'self', 0.75, 5)).toEqual([]);
  });

  it('is deterministic when similarities tie', () => {
    // Same angle either side of the axis — identical cosine, so id breaks the tie.
    const tied = [at('z', 20), { id: 'a', embedding: at('x', -20).embedding }];
    expect(selectRelated(tied, QUERY, 'self', 0.5, 5)).toEqual(['a', 'z']);
  });

  it('handles an empty candidate list', () => {
    expect(selectRelated([], QUERY, 'self')).toEqual([]);
  });
});
