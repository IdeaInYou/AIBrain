import { INDEX } from '../config.js';
import { logger } from '../logger.js';
import { osRequest, statusOf } from '../search/client.js';
import type { ProjectDoc } from '../types.js';

/** Slugs are the join key between memories, hooks and git remotes — keep them URL-safe. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export async function getProject(slug: string): Promise<ProjectDoc | null> {
  try {
    const res = await osRequest<{ _source: ProjectDoc }>(
      'GET',
      `/${INDEX.projects}/_doc/${encodeURIComponent(slug)}`,
    );
    return res._source;
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

export async function listProjects(): Promise<ProjectDoc[]> {
  const res = await osRequest<{ hits: { hits: { _source: ProjectDoc }[] } }>(
    'POST',
    `/${INDEX.projects}/_search`,
    { size: 200, query: { match_all: {} }, sort: [{ last_activity: 'desc' }] },
  );
  return res.hits.hits.map(h => h._source);
}

/**
 * Registers the project on first sight and keeps `last_activity` monotonic, so
 * the SessionStart hook can rank candidate projects without a separate write path.
 */
export async function touchProject(slug: string, activityIso: string): Promise<void> {
  const doc: ProjectDoc = {
    slug,
    name: slug,
    repo_names: [],
    aliases: [],
    last_activity: activityIso,
  };

  try {
    await osRequest(
      'POST',
      `/${INDEX.projects}/_update/${encodeURIComponent(slug)}`,
      {
        scripted_upsert: true,
        upsert: doc,
        script: {
          source:
            'if (ctx._source.last_activity == null || ctx._source.last_activity.compareTo(params.t) < 0) { ctx._source.last_activity = params.t }',
          params: { t: activityIso },
        },
      },
      { refresh: 'wait_for' },
    );
  } catch (err) {
    // Never fail a write because the registry lagged.
    logger.warn({ slug, err: (err as Error).message }, 'touchProject failed');
  }
}

export interface ProjectPatch {
  name?: string;
  aliases?: string[];
  repo_names?: string[];
}

export async function patchProject(slug: string, patch: ProjectPatch): Promise<ProjectDoc> {
  const existing = (await getProject(slug)) ?? {
    slug,
    name: slug,
    repo_names: [],
    aliases: [],
    last_activity: new Date().toISOString(),
  };

  const next: ProjectDoc = {
    ...existing,
    name: patch.name ?? existing.name,
    aliases: patch.aliases ? [...new Set(patch.aliases)] : existing.aliases,
    repo_names: patch.repo_names ? [...new Set(patch.repo_names)] : existing.repo_names,
  };

  await osRequest('PUT', `/${INDEX.projects}/_doc/${encodeURIComponent(slug)}`, next, { refresh: 'wait_for' });
  return next;
}

/**
 * Resolve a git remote URL or directory name to a known slug. Pure string
 * matching against the registry — the hook calls this, so it must not need a model.
 */
export function matchProject(hint: string, projects: ProjectDoc[]): string | null {
  const haystack = hint.toLowerCase();
  const candidates = projects.flatMap(p =>
    [p.slug, ...p.aliases, ...p.repo_names].filter(Boolean).map(needle => ({ slug: p.slug, needle: needle.toLowerCase() })),
  );
  // Longest needle wins, so "open-chance-web" beats a bare "open-chance".
  candidates.sort((a, b) => b.needle.length - a.needle.length);
  return candidates.find(c => haystack.includes(c.needle))?.slug ?? null;
}
