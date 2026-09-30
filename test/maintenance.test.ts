import { describe, expect, it } from 'vitest';
import { planMerges, type MergeCandidate } from '../src/core/maintenance.js';

const at = (id: string, deg: number, extra: Partial<MergeCandidate> = {}): MergeCandidate => ({
  id,
  project: 'p',
  type: 'fact',
  occurred_at: `2026-09-0${id.length}T00:00:00Z`,
  created_at: '2026-09-01T00:00:00Z',
  embedding: [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)],
  ...extra,
});

describe('planMerges', () => {
  it('keeps the newer record and drops the older', () => {
    const plan = planMerges(
      [at('old', 0, { occurred_at: '2026-01-01T00:00:00Z' }), at('new', 1, { occurred_at: '2026-02-01T00:00:00Z' })],
      0.95,
    );
    expect(plan).toEqual([{ keep: 'new', drop: 'old', cosine: expect.any(Number) }]);
  });

  it('ignores pairs below the threshold', () => {
    // cos(30°) ≈ 0.866
    expect(planMerges([at('a', 0), at('b', 30)], 0.95)).toEqual([]);
  });

  it('never merges across projects or types', () => {
    expect(planMerges([at('a', 0), at('b', 0, { project: 'q' })], 0.95)).toEqual([]);
    expect(planMerges([at('a', 0), at('b', 0, { type: 'decision' })], 0.95)).toEqual([]);
  });

  it('resolves a cluster of three without dropping the kept record', () => {
    const plan = planMerges(
      [
        at('x', 0, { occurred_at: '2026-01-01T00:00:00Z' }),
        at('y', 1, { occurred_at: '2026-02-01T00:00:00Z' }),
        at('z', 2, { occurred_at: '2026-03-01T00:00:00Z' }),
      ],
      0.95,
    );
    const dropped = plan.map(p => p.drop);
    expect(new Set(dropped).size).toBe(dropped.length);
    expect(dropped.sort()).toEqual(['x', 'y']);
    // Never fold into a record an earlier step already dropped.
    plan.forEach((p, i) => expect(dropped.slice(0, i)).not.toContain(p.keep));
  });
});
