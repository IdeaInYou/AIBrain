import { logger } from '../logger.js';
import { remember } from './remember.js';
import type { EpisodeBody, MemoryType, RememberAction } from '../types.js';

export interface ImportRecord {
  content?: string;
  type: MemoryType;
  project?: string;
  tags?: string[];
  importance?: number;
  refs?: string[];
  occurred_at?: string;
  episode?: Partial<EpisodeBody>;
}

export interface ImportResult {
  total: number;
  tally: Record<RememberAction, number>;
  errors: { index: number; error: string }[];
}

/**
 * Bulk load through the same path as every other write, so imported records get
 * passage embeddings, hash + vector dedupe, related links and deferred→todo.
 * Sequential on purpose: each write must see the previous one for dedupe.
 */
export async function importMemories(records: ImportRecord[]): Promise<ImportResult> {
  const result: ImportResult = { total: records.length, tally: { created: 0, updated: 0, merged: 0 }, errors: [] };

  for (const [index, record] of records.entries()) {
    try {
      const res = await remember({
        ...record,
        source: { kind: 'command', client: 'import', device: null, session_id: null },
      });
      result.tally[res.action]++;
    } catch (err) {
      result.errors.push({ index, error: err instanceof Error ? err.message : String(err) });
    }
  }

  logger.info({ total: result.total, ...result.tally, errors: result.errors.length }, 'import complete');
  return result;
}
