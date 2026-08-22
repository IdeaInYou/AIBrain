import { describe, expect, it } from 'vitest';
import { episodeLine, firstSentence } from '../src/core/summary.js';
import type { MemoryHit } from '../src/types.js';

function episode(partial: Partial<MemoryHit> & { did: string; deferred?: string; refs?: string[] }): MemoryHit {
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
      commits: [],
    },
    refs: partial.refs ?? [],
    has_note: false,
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

  // Deferred work is now split out into its own todo and shown under "Open
  // todos", so repeating it on the timeline line would say it twice.
  it('does not append deferred work — that lives as a todo now', () => {
    const line = episodeLine(
      episode({ did: 'Shipped the checkout rewrite.', deferred: 'Adyen multi-currency. Also i18n.' }),
    );
    expect(line).toBe('- 2026-08-20 · getcheckout · Shipped the checkout rewrite.');
    expect(line).not.toContain('Deferred');
  });

  it('points at the session note when one exists', () => {
    const line = episodeLine(
      episode({ did: 'Shipped the checkout rewrite.', refs: ['docs/memory/sessions/2026-08-20-a1b2c3d4.md'] }),
    );
    expect(line).toBe(
      '- 2026-08-20 · getcheckout · Shipped the checkout rewrite. → docs/memory/sessions/2026-08-20-a1b2c3d4.md',
    );
  });

  it('omits the arrow when there is no note', () => {
    expect(episodeLine(episode({ did: 'Did a thing.' }))).not.toContain('→');
  });

  it('uses only the first ref — decision ADRs do not clutter the timeline', () => {
    const line = episodeLine(
      episode({ did: 'Did a thing.', refs: ['docs/memory/sessions/s.md', 'docs/memory/decisions/d.md'] }),
    );
    expect(line).toContain('→ docs/memory/sessions/s.md');
    expect(line).not.toContain('decisions/d.md');
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
