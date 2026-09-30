import { describe, expect, it } from 'vitest';
import { formatDigest, type Digest } from '../src/core/digest.js';

const empty: Digest = {
  period: 'daily',
  since: '2026-09-29T10:00:00.000Z',
  until: '2026-09-30T10:00:00.000Z',
  counts: { episode: 0, decision: 0, preference: 0, todo: 0, fact: 0 },
  episodes: [],
  decisions: [],
  facts: [],
  todos: [],
};

describe('formatDigest', () => {
  it('says so when the window is empty', () => {
    expect(formatDigest(empty)).toContain('Nothing recorded in this window.');
  });

  it('prints full content without a trailing ellipsis', () => {
    const text = formatDigest({
      ...empty,
      decisions: [{ id: '1', project: 'aibrain', content: 'Use 0.82 as dedupe threshold.', occurred_at: '2026-09-30T08:00:00Z' }],
    });
    expect(text).toContain('- 2026-09-30 · aibrain · Use 0.82 as dedupe threshold.');
    expect(text).not.toContain('...');
    expect(text).not.toContain('Nothing recorded');
  });
});
