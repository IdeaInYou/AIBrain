import { config } from '../config.js';
import type { MemoryHit } from '../types.js';
import { allPreferences, openTodos, recentEpisodes } from './memory.js';

/** First sentence, so one session takes one line in the timeline. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(\s|$)/s.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

const dayOf = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : iso.slice(0, 10));

export function episodeLine(hit: MemoryHit): string {
  const headline = firstSentence(hit.episode?.did?.trim() || hit.content);
  const deferred = hit.episode?.deferred?.trim();
  const tail = deferred ? ` Deferred: ${firstSentence(deferred)}` : '';
  return `- ${dayOf(hit.occurred_at)} · ${hit.project} · ${headline}${tail}`;
}

export interface SummaryOptions {
  project?: string;
  days?: number;
  maxEpisodes?: number;
}

/**
 * The chronology Claude reads at the start of every conversation. Assembled from
 * a template rather than written by a model — no LLM anywhere on this server.
 */
export async function buildSummary(opts: SummaryOptions = {}): Promise<string> {
  const days = opts.days ?? config.SUMMARY_DAYS;
  const maxEpisodes = opts.maxEpisodes ?? config.SUMMARY_MAX_EPISODES;
  const project = opts.project?.trim() || undefined;

  const [episodes, todos, prefs] = await Promise.all([
    recentEpisodes(days, maxEpisodes, project),
    openTodos(project),
    allPreferences(),
  ]);

  const sections: string[] = [];
  const scope = project ? ` — ${project}` : '';

  sections.push(
    episodes.length
      ? `## Last ${days} days${scope}\n${episodes.map(episodeLine).join('\n')}`
      : `## Last ${days} days${scope}\n- (no sessions recorded)`,
  );

  if (todos.length) {
    sections.push(`## Open todos\n${todos.map(t => `- [${t.project}] ${t.content}`).join('\n')}`);
  }
  if (prefs.length) {
    sections.push(`## Preferences\n${prefs.map(p => `- ${p.content}`).join('\n')}`);
  }

  // Spec §4.1: the closing nudge is what produces the follow-up memory_recall.
  sections.push('Call memory_recall for details on any item.');
  return sections.join('\n\n');
}
