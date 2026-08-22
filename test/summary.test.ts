import { describe, expect, it } from 'vitest';
import { episodeLine, firstSentence } from '../src/core/summary.js';
import type { MemoryHit } from '../src/types.js';

function episode(partial: Partial<MemoryHit> & { did: string; deferred?: string }): MemoryHit {
  return {
    id: 'x',
    content: partial.did,
    type: 'episode',
    project: partial.project ?? 'getcheckout',
    tags: [],
    importance: 3,
    status: 'active',
    episode: {
      did: partial.did,
      why: '',
      outcome: '',
      deferred: partial.deferred ?? '',
      files: [],
    },
    occurred_at: partial.occurred_at ?? '2026-08-20T14:03:11.000Z',
    created_at: '2026-08-20T14:03:11.000Z',
    score: 1,
  };
}

describe('firstSentence', () => {
  it('stops at the first terminator', () => {
    expect(firstSentence('Fixed the cookie bug. Then refactored routing.')).toBe('Fixed the cookie bug.');
  });

  it('returns the whole string when there is no terminator', () => {
    expect(firstSentence('Investigated slow queries')).toBe('Investigated slow queries');
  });

  it('handles multi-line input', () => {
    expect(firstSentence('Line one.\nLine two.')).toBe('Line one.');
  });
});

describe('episodeLine', () => {
  it('renders date · project · headline', () => {
    const line = episodeLine(episode({ did: 'Fixed country-detection cookie precedence.' }));
    expect(line).toBe('- 2026-08-20 · getcheckout · Fixed country-detection cookie precedence.');
  });

  it('appends deferred work when present', () => {
    const line = episodeLine(
      episode({ did: 'Shipped the checkout rewrite.', deferred: 'Adyen multi-currency. Also i18n.' }),
    );
    expect(line).toBe(
      '- 2026-08-20 · getcheckout · Shipped the checkout rewrite. Deferred: Adyen multi-currency.',
    );
  });

  it('keeps one episode to one line', () => {
    const line = episodeLine(
      episode({ did: 'Did a thing. Then another thing. And a third.', deferred: 'More things.' }),
    );
    expect(line.split('\n')).toHaveLength(1);
  });

  it('falls back to content when the episode body is missing', () => {
    const hit = { ...episode({ did: 'ignored' }), episode: null, content: 'Raw content here.' };
    expect(episodeLine(hit)).toContain('Raw content here.');
  });
});
