import { randomUUID } from 'node:crypto';
import { INDEX, config } from '../config.js';
import { embedOne } from '../embed/embedder.js';
import { osRequest } from '../search/client.js';
import { contentHash } from '../search/dedupe.js';
import { logger } from '../logger.js';
import type { MemoryDoc, MemoryType } from '../types.js';

export interface ImportRecord {
  content: string;
  type: MemoryType;
  project: string;
  importance?: number;
  tags?: string[];
  refs?: string[];
  deferred?: string;
  did?: string;
  why?: string;
  outcome?: string;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: Array<{ index: number; error: string }>;
}

/**
 * Bulk import memories from external source (JSON, markdown list, etc).
 * Deduplicates by content hash, embeds automatically.
 */
export async function importMemories(records: ImportRecord[]): Promise<ImportResult> {
  const result: ImportResult = {
    total: records.length,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    errors: [],
  };

  const existingHashes = new Set<string>();

  try {
    // Check existing hashes
    const hashRes = await osRequest<{ hits: { hits: any[] } }>(
      'POST',
      `/${INDEX.memories}/_search`,
      {
        size: 10000,
        _source: ['content_hash'],
        query: { term: { status: 'active' } },
      }
    );

    for (const hit of hashRes.hits?.hits ?? []) {
      existingHashes.add(hit._source.content_hash);
    }
  } catch (err) {
    result.errors.push({ index: -1, error: `Failed to load existing hashes: ${String(err)}` });
    // Continue anyway — duplicates will be caught per-record
  }

  // Process records
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    try {
      // Validate
      if (!record.content || !record.type || !record.project) {
        throw new Error('Missing required fields: content, type, project');
      }

      // Check hash
      const hash = contentHash(record.content);
      if (existingHashes.has(hash)) {
        result.duplicates++;
        result.skipped++;
        continue;
      }

      // Embed
      const embedding = await embedOne(record.content, 'query');

      // Build doc
      const now = new Date().toISOString();
      const doc: MemoryDoc = {
        content: record.content,
        type: record.type,
        project: record.project,
        status: 'active',
        importance: record.importance ?? 3,
        tags: record.tags ?? [],
        refs: record.refs ?? [],
        embedding,
        content_hash: hash,
        created_at: now,
        occurred_at: now,
        source: { kind: 'tool' as const, client: 'bulk-import', device: 'import', session_id: randomUUID() },
        superseded_by: null,
        related: [],
        note: null,
        episode: null,
      };

      // Add episode fields if present
      if (record.did || record.why || record.outcome) {
        doc.episode = {
          did: record.did ?? '',
          why: record.why ?? '',
          outcome: record.outcome ?? '',
          deferred: record.deferred ?? '',
          files: [],
          commits: [],
        };
      }

      // Insert
      await osRequest('POST', `/${INDEX.memories}/_doc`, doc);

      existingHashes.add(hash);
      result.imported++;
    } catch (err) {
      result.errors.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
      result.skipped++;
    }
  }

  logger.info(result, `bulk import complete`);
  return result;
}

/**
 * Import from newline-delimited JSON (one record per line).
 * Each line is a ImportRecord object.
 */
export async function importFromNDJSON(ndjson: string): Promise<ImportResult> {
  const records: ImportRecord[] = [];

  for (const line of ndjson.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      records.push(JSON.parse(trimmed) as ImportRecord);
    } catch (err) {
      logger.warn({ line, err }, 'failed to parse NDJSON line');
    }
  }

  return importMemories(records);
}

/**
 * Import from CSV (headerless: content,type,project,importance,tags,refs).
 * Tags and refs are semicolon-separated.
 */
export async function importFromCSV(csv: string): Promise<ImportResult> {
  const records: ImportRecord[] = [];

  for (const line of csv.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = line.split(',').map(s => s.trim());
    if (parts.length < 3) continue;

    const [content, type, project, importance, tags, refs] = parts;
    if (!content || !type || !project) continue;

    records.push({
      content,
      type: type as MemoryType,
      project,
      importance: importance ? parseInt(importance, 10) : undefined,
      tags: tags ? tags.split(';').map(t => t.trim()) : undefined,
      refs: refs ? refs.split(';').map(r => r.trim()) : undefined,
    });
  }

  return importMemories(records);
}
