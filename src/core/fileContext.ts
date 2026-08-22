import { INDEX } from '../config.js';
import { osRequest } from '../search/client.js';
import type { MemoryDoc } from '../types.js';
import { recordEvent } from './events.js';
import { firstSentence } from './summary.js';

export interface FileContextItem {
  id: string;
  date: string;
  type: string;
  summary: string;
  why: string;
  ref: string;
  /** How this record was matched — exposed so the hook can explain itself. */
  match: 'file' | 'mention' | 'directory';
}

export interface FileContextResult {
  path: string;
  items: FileContextItem[];
}

// One file gets edited many times in a session; the hook caches per session too,
// but a shared 60 s cache also covers parallel agents and repeated sessions.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: FileContextResult }>();

interface Hit {
  _id: string;
  _source: MemoryDoc;
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

/**
 * Why did this file change before, and what for? Answered from episodes whose
 * `episode.files` include it, decisions that name it, and — weakest — other work
 * in the same directory.
 */
export async function fileContext(path: string, k: number): Promise<FileContextResult> {
  const key = `${path}|${k}`;
  const started = Date.now();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    recordEvent({ kind: 'pretool', k, hits: cached.value.items.length, latency_ms: 0, cached: true });
    return cached.value;
  }

  const dir = dirOf(path);
  const should: unknown[] = [
    { term: { 'episode.files': path } },
    { term: { refs: path } },
    { match_phrase: { content: path } },
  ];
  if (dir) should.push({ prefix: { 'episode.files': `${dir}/` } });

  const res = await osRequest<{ hits: { hits: Hit[] } }>('POST', `/${INDEX.memories}/_search`, {
    size: Math.max(k * 4, 12),
    _source: { excludes: ['embedding', 'note'] },
    query: {
      bool: {
        filter: [{ terms: { status: ['active'] } }],
        should,
        minimum_should_match: 1,
      },
    },
    sort: [{ occurred_at: 'desc' }],
  });

  // Rank in Node rather than with query boosts: the tiers are categorical, and
  // "this exact file" must never lose to "something in the same folder".
  const rank = { file: 0, mention: 1, directory: 2 } as const;

  const items: FileContextItem[] = res.hits.hits
    .map(hit => {
      const s = hit._source;
      const files = s.episode?.files ?? [];
      let match: FileContextItem['match'];
      if (files.includes(path) || (s.refs ?? []).includes(path)) match = 'file';
      else if (s.content.includes(path)) match = 'mention';
      else match = 'directory';

      return {
        id: hit._id,
        date: s.occurred_at?.slice(0, 10) ?? '',
        type: s.type,
        summary: firstSentence(s.episode?.did?.trim() || s.content),
        why: firstSentence(s.episode?.why?.trim() ?? ''),
        ref: s.refs?.[0] ?? '',
        match,
      };
    })
    .sort((a, b) => rank[a.match] - rank[b.match] || b.date.localeCompare(a.date))
    .slice(0, k);

  const value = { path, items };
  cache.set(key, { at: Date.now(), value });
  recordEvent({ kind: 'pretool', k, hits: items.length, latency_ms: Date.now() - started, cached: false });
  return value;
}

export function clearFileContextCache(): void {
  cache.clear();
}
