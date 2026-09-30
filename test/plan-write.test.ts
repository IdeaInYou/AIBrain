import { describe, expect, it } from 'vitest';
import { planWrite, type Neighbor } from '../src/search/dedupe.js';

const vec = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const n = (id: string, content: string, deg: number): Neighbor => ({ id, content, embedding: vec(deg) });
const Q = vec(0);
// cos(10°)=0.985, cos(30°)=0.866, cos(40°)=0.766, cos(60°)=0.5
const DEDUPE = 0.9;
const RELATED = 0.75;

describe('planWrite', () => {
  it('writes new when nothing is close', () => {
    const plan = planWrite('AIBrain uses OpenSearch for storage.', Q, [n('a', 'Unrelated fact about billing.', 60)], DEDUPE, RELATED);
    expect(plan).toEqual({ action: 'new', similar: [] });
  });

  it('supersedes a neighbour above the dedupe threshold', () => {
    const plan = planWrite('AIBrain stores memories in OpenSearch.', Q, [n('a', 'Memories live in OpenSearch.', 10)], DEDUPE, RELATED);
    expect(plan.action).toBe('supersede');
    expect(plan.target?.id).toBe('a');
  });

  it('treats text already contained in a stored record as nothing new', () => {
    const plan = planWrite(
      'dedupe threshold is 0.82',
      Q,
      [n('a', 'AIBrain dedupe threshold is 0.82, measured on 28 real records.', 40)],
      DEDUPE,
      RELATED,
    );
    expect(plan.action).toBe('contained');
    expect(plan.target?.id).toBe('a');
  });

  it('supersedes a stored record the new text fully contains, even below the dedupe bar', () => {
    const plan = planWrite(
      'AIBrain dedupe threshold is 0.82, measured on 28 real records.',
      Q,
      [n('a', 'dedupe threshold is 0.82', 40)],
      DEDUPE,
      RELATED,
    );
    expect(plan.action).toBe('supersede');
  });

  it('ignores containment when the texts are not even related', () => {
    const plan = planWrite('dedupe threshold is 0.82', Q, [n('a', 'the dedupe threshold is 0.82 in a different system', 60)], DEDUPE, RELATED);
    expect(plan.action).toBe('new');
  });

  it('returns related-but-distinct neighbours as similar, excluding the target', () => {
    const plan = planWrite(
      'OAuth uses DCR and PKCE.',
      Q,
      [n('dup', 'OAuth uses DCR plus PKCE.', 10), n('near', 'Static bearer stays for old installs.', 30), n('far', 'Billing.', 60)],
      DEDUPE,
      RELATED,
    );
    expect(plan.target?.id).toBe('dup');
    expect(plan.similar.map(s => s.id)).toEqual(['near']);
  });

  it('does not count very short strings as containment', () => {
    const plan = planWrite('OpenSearch', Q, [n('a', 'AIBrain runs OpenSearch 2 on the VPS.', 40)], DEDUPE, RELATED);
    expect(plan.action).toBe('new');
  });
});
