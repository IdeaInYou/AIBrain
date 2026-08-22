import { describe, expect, it } from 'vitest';
import { finalScore, rerank, rrf } from '../src/search/rerank.js';
import type { MemoryStatus, MemoryType } from '../src/types.js';

const NOW = Date.parse('2026-08-22T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function hit(type: MemoryType, ageDays: number, score = 1, importance = 3, status: MemoryStatus = 'active') {
  return { score, type, importance, status, occurred_at: daysAgo(ageDays) };
}

describe('finalScore', () => {
  it('decays episodes on a 90-day scale', () => {
    expect(finalScore(hit('episode', 90), NOW)).toBeCloseTo(Math.exp(-1), 5);
  });

  it('decays decisions half as fast as episodes', () => {
    const episode = finalScore(hit('episode', 90), NOW);
    const decision = finalScore(hit('decision', 90), NOW);
    expect(decision).toBeGreaterThan(episode);
  });

  it('never decays preferences', () => {
    expect(finalScore(hit('preference', 3650), NOW)).toBe(1);
  });

  it('boosts open todos but not closed ones', () => {
    expect(finalScore(hit('todo', 10), NOW)).toBeCloseTo(1.2);
    expect(finalScore(hit('todo', 10, 1, 3, 'done'), NOW)).toBeCloseTo(1);
  });

  it('applies the importance boost to decisions', () => {
    const high = finalScore(hit('decision', 0, 1, 5), NOW);
    const low = finalScore(hit('decision', 0, 1, 1), NOW);
    expect(high / low).toBeCloseTo(1.2 / 0.8, 5);
  });

  it('puts recency ahead of raw relevance for episodes', () => {
    // A slightly worse match from last week beats a great match from last year.
    const recent = finalScore(hit('episode', 7, 0.7), NOW);
    const stale = finalScore(hit('episode', 365, 1.0), NOW);
    expect(recent).toBeGreaterThan(stale);
  });
});

describe('rerank', () => {
  it('sorts by final score and rewrites score in place', () => {
    const out = rerank([hit('episode', 365), hit('preference', 365)], NOW);
    expect(out[0]!.type).toBe('preference');
    expect(out[0]!.score).toBe(1);
    expect(out[1]!.score).toBeLessThan(1);
  });
});

describe('rrf', () => {
  it('rewards a document found by both retrievers over one found by a single one', () => {
    const scores = rrf([
      ['a', 'b', 'c'],
      ['b', 'd', 'e'],
    ]);
    // `b` is 2nd and 1st; `a` is 1st but appears only once.
    expect(scores.get('b')).toBeGreaterThan(scores.get('a')!);
  });

  it('preserves rank order within a single ranking', () => {
    const scores = rrf([['a', 'b', 'c']]);
    expect(scores.get('a')).toBeGreaterThan(scores.get('b')!);
    expect(scores.get('b')).toBeGreaterThan(scores.get('c')!);
  });
});
