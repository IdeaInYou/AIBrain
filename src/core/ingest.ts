import { LIMITS, config } from '../config.js';
import { logger } from '../logger.js';
import { recordEvent } from './events.js';
import { patchProject } from './projects.js';
import { remember } from './remember.js';
import type { EpisodeBody, FactTally, MemorySource, MemoryType } from '../types.js';

export interface IngestFact {
  content: string;
  type: MemoryType;
  project?: string;
  tags?: string[];
  importance?: number;
}

export interface IngestInput {
  episode?: Partial<EpisodeBody>;
  facts?: IngestFact[];
  project?: string;
  source?: MemorySource;
  occurred_at?: string;
  /** Attached to the episode only — facts carry their own refs if they have any. */
  refs?: string[];
  note?: string;
  project_brief?: string;
}

export interface IngestResult {
  episode_id?: string;
  project: string;
  facts: FactTally;
  skipped: number;
  brief_updated?: boolean;
}

/**
 * The hook's write path: one episode plus up to a handful of durable facts.
 * Text arrives already in English — the server does not translate.
 */
export async function ingest(input: IngestInput): Promise<IngestResult> {
  const started = Date.now();
  const project = input.project?.trim() || config.DEFAULT_PROJECT;
  const facts = (input.facts ?? []).slice(0, LIMITS.ingestFacts);
  const result: IngestResult = { project, facts: { created: 0, updated: 0, merged: 0 }, skipped: 0 };

  const episodeText = [input.episode?.did, input.episode?.why, input.episode?.outcome]
    .map(s => s?.trim())
    .filter(Boolean)
    .join(' ');

  if (input.episode && episodeText.length >= LIMITS.minEpisodeChars) {
    const written = await remember({
      type: 'episode',
      project,
      episode: input.episode,
      ...(input.source ? { source: input.source } : {}),
      ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
      ...(input.refs?.length ? { refs: input.refs } : {}),
      ...(input.note ? { note: input.note } : {}),
    });
    result.episode_id = written.id;
  } else if (input.episode) {
    result.skipped++;
    logger.info({ project, chars: episodeText.length }, 'ingest: episode too thin, skipped');
  }

  for (const fact of facts) {
    if (fact.type === 'episode') {
      result.skipped++;
      continue; // episodes arrive via the `episode` field, not the fact list
    }
    if (!fact.content?.trim()) {
      result.skipped++;
      continue;
    }
    try {
      const written = await remember({
        content: fact.content,
        type: fact.type,
        project: fact.project?.trim() || project,
        tags: fact.tags ?? [],
        importance: fact.importance ?? 3,
        ...(input.source ? { source: input.source } : {}),
        ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
      });
      result.facts[written.action]++;
    } catch (err) {
      result.skipped++;
      logger.warn({ err: (err as Error).message, type: fact.type }, 'ingest: fact rejected');
    }
  }

  // `general` is a catch-all, not a project — a brief there would describe nothing.
  if (input.project_brief?.trim() && project !== config.DEFAULT_PROJECT) {
    await patchProject(project, { brief: input.project_brief });
    result.brief_updated = true;
  }

  logger.info({ ...result.facts, skipped: result.skipped, project }, 'ingest complete');
  recordEvent({
    kind: 'ingest',
    project,
    source_kind: input.source?.kind ?? 'hook',
    client: input.source?.client ?? null,
    hits: result.facts.created + result.facts.updated + result.facts.merged,
    latency_ms: Date.now() - started,
  });
  return result;
}
