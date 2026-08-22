export const MEMORY_TYPES = ['episode', 'decision', 'preference', 'todo', 'fact'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Types that go through hash + vector dedupe. `episode` never does — each session is its own record. */
export const DEDUPED_TYPES = ['decision', 'preference', 'todo', 'fact'] as const;

export const MEMORY_STATUSES = ['active', 'superseded', 'done', 'deleted'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const SOURCE_KINDS = ['hook', 'tool', 'command'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface MemorySource {
  kind: SourceKind;
  client: string | null;
  device: string | null;
  session_id: string | null;
}

/** Structured half of an episode; `content` carries the same text flattened for search. */
export interface EpisodeBody {
  did: string;
  why: string;
  outcome: string;
  deferred: string;
  files: string[];
}

export interface MemoryDoc {
  content: string;
  embedding: number[];
  type: MemoryType;
  project: string;
  tags: string[];
  importance: number;
  status: MemoryStatus;
  superseded_by: string | null;
  episode: EpisodeBody | null;
  source: MemorySource;
  /** When the work happened — the session date, not the write time. Drives recency. */
  occurred_at: string;
  created_at: string;
  content_hash: string;
}

export interface MemoryHit {
  id: string;
  content: string;
  type: MemoryType;
  project: string;
  tags: string[];
  importance: number;
  status: MemoryStatus;
  episode: EpisodeBody | null;
  occurred_at: string;
  created_at: string;
  score: number;
}

export interface ProjectDoc {
  slug: string;
  name: string;
  repo_names: string[];
  aliases: string[];
  last_activity: string;
}

export interface MemoryFilters {
  project?: string[];
  type?: MemoryType[];
  tags?: string[];
  status?: MemoryStatus[];
  /** ISO lower bound on occurred_at. */
  since?: string;
}

export type RememberAction = 'created' | 'updated' | 'merged';

export interface RememberResult {
  id: string;
  action: RememberAction;
  project: string;
  superseded: string[];
}

export interface FactTally {
  created: number;
  updated: number;
  merged: number;
}
