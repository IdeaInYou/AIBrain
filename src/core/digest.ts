import { listMemories, type RawHit } from '../search/hybrid.js';
import { MEMORY_TYPES, type MemoryType } from '../types.js';

export type DigestPeriod = 'daily' | 'weekly';

interface DigestItem {
  id: string;
  project: string;
  content: string;
  occurred_at: string;
}

export interface Digest {
  period: DigestPeriod;
  since: string;
  until: string;
  counts: Record<MemoryType, number>;
  episodes: DigestItem[];
  decisions: DigestItem[];
  facts: DigestItem[];
  todos: DigestItem[];
}

const WINDOW_MS: Record<DigestPeriod, number> = { daily: 86_400_000, weekly: 7 * 86_400_000 };
const PER_TYPE = 50;

const item = (h: RawHit): DigestItem => ({
  id: h._id,
  project: h._source.project,
  content: h._source.content,
  occurred_at: h._source.occurred_at,
});

/**
 * What happened in a rolling window, by when the work happened (occurred_at),
 * not when it was written — backfilled git commits land on their own dates.
 */
export async function generateDigest(period: DigestPeriod, project?: string, now = new Date()): Promise<Digest> {
  const until = now.toISOString();
  const since = new Date(now.getTime() - WINDOW_MS[period]).toISOString();

  const byType = await Promise.all(
    MEMORY_TYPES.map(type =>
      listMemories({ type: [type], since, until, ...(project ? { project: [project] } : {}) }, PER_TYPE),
    ),
  );
  const hits = Object.fromEntries(MEMORY_TYPES.map((t, i) => [t, byType[i]!])) as Record<MemoryType, RawHit[]>;

  return {
    period,
    since,
    until,
    counts: Object.fromEntries(MEMORY_TYPES.map(t => [t, hits[t].length])) as Record<MemoryType, number>,
    episodes: hits.episode.map(item),
    decisions: hits.decision.map(item),
    facts: [...hits.fact].sort((a, b) => b._source.importance - a._source.importance).slice(0, 10).map(item),
    todos: hits.todo.map(item),
  };
}

export function formatDigest(d: Digest): string {
  const day = (iso: string) => iso.slice(0, 10);
  const lines = [`# Memory digest — ${d.period} (${day(d.since)} → ${day(d.until)})`, ''];
  const section = (title: string, items: DigestItem[]) => {
    if (!items.length) return;
    lines.push(`## ${title}`, ...items.map(i => `- ${day(i.occurred_at)} · ${i.project} · ${i.content}`), '');
  };
  section('Sessions', d.episodes);
  section('Decisions', d.decisions);
  section('Facts', d.facts);
  section('New todos', d.todos);
  if (lines.length === 2) lines.push('Nothing recorded in this window.');
  return lines.join('\n');
}
