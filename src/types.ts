export const MEMORY_TYPES = ['episode', 'decision', 'preference', 'todo', 'fact'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Types that go through hash + vector dedupe. `episode` never does — each session is its own record. */
export const DEDUPED_TYPES = ['decision', 'preference', 'todo', 'fact'] as const;

export const MEMORY_STATUSES = ['active', 'superseded', 'done', 'deleted'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const SOURCE_KINDS = ['hook', 'tool', 'command', 'git'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface MemorySource {
  kind: SourceKind;
  client: string | null;
  device: string | null;
  session_id: string | null;
}

export interface CommitRef {
  sha: string;
  message: string;
}

/** Structured half of an episode; `content` carries the same text flattened for search. */
export interface EpisodeBody {
  did: string;
  why: string;
  outcome: string;
  deferred: string;
  files: string[];
  /** Commits made during this session — the "what exactly", next to the "why". */
  commits: CommitRef[];
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
  /** Ids of nearby memories, kept symmetric on both sides. */
  related: string[];
  /** Repo-relative paths of note files the Stop hook wrote for this record. */
  refs: string[];
  /** Full markdown of the session/decision note, so clients without the repo can read it. */
  note: string | null;
  /** When the work happened — the session date, not the write time. Drives recency. */
  occurred_at: string;
  created_at: string;
  content_hash: string;
  /** Set by memory_update: an explicit correction that automatic merging must never hide. */
  locked?: boolean;
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
  refs: string[];
  /** True when a note exists — the text itself is fetched via memory://notes/{id}. */
  has_note: boolean;
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
  /** Standing context for the project, rewritten by the Stop hook when something durable changes. */
  brief?: string | null;
  brief_updated_at?: string | null;
}

export interface MemoryFilters {
  project?: string[];
  type?: MemoryType[];
  tags?: string[];
  status?: MemoryStatus[];
  /** ISO lower bound on occurred_at. */
  since?: string;
  /** ISO upper bound on occurred_at. */
  until?: string;
  minImportance?: number;
}

export type RememberAction = 'created' | 'updated' | 'merged';

export interface RememberResult {
  id: string;
  action: RememberAction;
  project: string;
  superseded: string[];
  /** Near but below the merge bar — the caller may want memory_update on one of these instead. */
  similar?: { id: string; content: string; similarity: number }[];
}

export interface FactTally {
  created: number;
  updated: number;
  merged: number;
}
