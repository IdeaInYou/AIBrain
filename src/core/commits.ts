import { INDEX, config } from '../config.js';
import { logger } from '../logger.js';
import { osRequest } from '../search/client.js';
import type { CommitRef, MemoryDoc } from '../types.js';
import { recordEvent } from './events.js';
import { remember } from './remember.js';
import { touchProject } from './projects.js';

/**
 * A commit made during an active session belongs to that session's episode: the
 * episode says why, the commits say what exactly. Outside that window the commit
 * stands on its own as a light episode, which is how work done without Claude
 * Code still reaches memory.
 */
const ATTACH_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface CommitInput {
  project?: string;
  commit: { sha: string; message: string; stat?: string; files?: string[] };
  source?: { client?: string | null; device?: string | null };
}

export interface CommitResult {
  action: 'attached' | 'created' | 'duplicate';
  id: string;
  project: string;
}

/** Idempotency: a re-POSTed sha must not double-count. */
async function findBySha(sha: string): Promise<string | null> {
  const res = await osRequest<{ hits: { hits: { _id: string }[] } }>('POST', `/${INDEX.memories}/_search`, {
    size: 1,
    _source: false,
    query: { bool: { filter: [{ term: { 'episode.commits.sha': sha } }] } },
  });
  return res.hits.hits[0]?._id ?? null;
}

async function findRecentEpisode(project: string, device: string | null): Promise<{ id: string; doc: MemoryDoc } | null> {
  const filter: unknown[] = [
    { term: { type: 'episode' } },
    { term: { status: 'active' } },
    { term: { project } },
    { range: { occurred_at: { gte: new Date(Date.now() - ATTACH_WINDOW_MS).toISOString() } } },
  ];
  // Device matters: two machines working the same project must not merge.
  if (device) filter.push({ term: { 'source.device': device } });

  const res = await osRequest<{ hits: { hits: { _id: string; _source: MemoryDoc }[] } }>(
    'POST',
    `/${INDEX.memories}/_search`,
    { size: 1, query: { bool: { filter } }, sort: [{ occurred_at: 'desc' }] },
  );
  const hit = res.hits.hits[0];
  return hit ? { id: hit._id, doc: hit._source } : null;
}

export async function ingestCommit(input: CommitInput): Promise<CommitResult> {
  const project = input.project?.trim() || config.DEFAULT_PROJECT;
  const sha = input.commit.sha?.trim();
  if (!sha) throw new Error('commit.sha is required');

  const message = (input.commit.message ?? '').trim();
  if (!message) throw new Error('commit.message is required');

  const files = (input.commit.files ?? []).slice(0, 30);
  const device = input.source?.device ?? null;

  const already = await findBySha(sha);
  if (already) {
    logger.info({ sha, id: already }, 'commit: already recorded');
    return { action: 'duplicate', id: already, project };
  }

  const recent = await findRecentEpisode(project, device);
  if (recent) {
    const commits: CommitRef[] = [...(recent.doc.episode?.commits ?? []), { sha, message }];
    const merged = [...new Set([...(recent.doc.episode?.files ?? []), ...files])].slice(0, 30);

    await osRequest(
      'POST',
      `/${INDEX.memories}/_update/${recent.id}`,
      { doc: { episode: { ...recent.doc.episode, commits, files: merged } } },
      { refresh: 'wait_for' },
    );
    logger.info({ sha, id: recent.id, project }, 'commit: attached to episode');
    recordEvent({ kind: 'commit', project, source_kind: 'git', client: 'git', hits: 1 });
    return { action: 'attached', id: recent.id, project };
  }

  // No session to attach to — someone committed without Claude Code.
  const [subject, ...rest] = message.split('\n');
  const written = await remember({
    type: 'episode',
    project,
    importance: 2,
    episode: {
      did: subject ?? message,
      why: '',
      outcome: input.commit.stat ?? '',
      deferred: '',
      files,
      commits: [{ sha, message }],
    },
    source: {
      kind: 'git',
      client: input.source?.client ?? 'git',
      device,
      // No session id: this must not collide with the Stop hook's episode dedupe.
      session_id: null,
    },
  });

  void rest;
  await touchProject(project, new Date().toISOString());
  logger.info({ sha, id: written.id, project }, 'commit: standalone episode');
  recordEvent({ kind: 'commit', project, source_kind: 'git', client: 'git', hits: 0 });
  return { action: 'created', id: written.id, project };
}
