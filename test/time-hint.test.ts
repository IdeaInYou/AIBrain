import { describe, expect, it } from 'vitest';
import { parseTimeHint } from '../src/core/memory.js';

// Wednesday 2026-09-30 15:00 UTC
const NOW = new Date('2026-09-30T15:00:00Z');

describe('parseTimeHint', () => {
  it('returns null when the query names no time', () => {
    expect(parseTimeHint('how does OAuth work in AIBrain', NOW)).toBeNull();
  });

  it('today and yesterday are calendar days', () => {
    expect(parseTimeHint('what did we do today', NOW)).toEqual({ since: '2026-09-30T00:00:00.000Z' });
    expect(parseTimeHint('what broke yesterday', NOW)).toEqual({
      since: '2026-09-29T00:00:00.000Z',
      until: '2026-09-30T00:00:00.000Z',
    });
  });

  it('last week is the previous Monday-based week', () => {
    expect(parseTimeHint('decisions from last week', NOW)).toEqual({
      since: '2026-09-21T00:00:00.000Z',
      until: '2026-09-28T00:00:00.000Z',
    });
    expect(parseTimeHint('this week', NOW)).toEqual({ since: '2026-09-28T00:00:00.000Z' });
  });

  it('rolling spans with digits or words', () => {
    expect(parseTimeHint('past 3 days', NOW)).toEqual({ since: '2026-09-27T15:00:00.000Z' });
    expect(parseTimeHint('in the last two weeks', NOW)).toEqual({ since: '2026-09-16T15:00:00.000Z' });
  });

  it('last month is the previous calendar month', () => {
    expect(parseTimeHint('what changed last month', NOW)).toEqual({
      since: '2026-08-01T00:00:00.000Z',
      until: '2026-09-01T00:00:00.000Z',
    });
  });

  it('does not fire on words that merely contain the keywords', () => {
    expect(parseTimeHint('the todayFlag setting', NOW)).toBeNull();
  });
});
