import { config } from '../config.js';
import type { MemoryHit } from '../types.js';
import { recordEvent } from './events.js';
import { allPreferences, earlierEpisodes, milestones, openTodos, recentEpisodes } from './memory.js';

/** First sentence, so one session takes one line in the timeline. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.+?[.!?])(\s|$)/s.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

const dayOf = (iso: string) => (Number.isNaN(Date.parse(iso)) ? iso : iso.slice(0, 10));

/**
 * One line per session. Only the first sentence of `did` — anything deferred is
 * now its own todo, so repeating it here would say the same thing twice.
 */
export function episodeLine(hit: MemoryHit): string {
  const headline = firstSentence(hit.episode?.did?.trim() || hit.content);
  // The first ref is the session note; pointing at it is what makes the one-line
  // timeline expandable without putting the whole note in the summary.
  const ref = hit.refs?.[0] ? ` → ${hit.refs[0]}` : '';
  return `- ${dayOf(hit.occurred_at)} · ${hit.project} · ${headline}${ref}`;
}

/** Groups older episodes by calendar month so long history stays skimmable. */
export function groupByMonth(hits: MemoryHit[]): Map<string, MemoryHit[]> {
  const months = new Map<string, MemoryHit[]>();
  for (const hit of hits) {
    const key = dayOf(hit.occurred_at).slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(hit);
  }
  return months;
}

/** Caps on the history blocks — the summary has to stay inside ~800 tokens. */
const EARLIER_LIMIT = 24;
const MILESTONE_LIMIT = 10;

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

  const started = Date.now();
  const [episodes, earlier, marks, todos, prefs] = await Promise.all([
    recentEpisodes(days, maxEpisodes, project),
    earlierEpisodes(days, EARLIER_LIMIT, project),
    milestones(MILESTONE_LIMIT, project),
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

  // `days` bounds the Recent block only — older work stays visible, grouped by
  // month, so nothing silently falls out of the overview as it ages.
  if (earlier.length) {
    const blocks = [...groupByMonth(earlier).entries()]
      .map(([month, hits]) => `### ${month}\n${hits.map(episodeLine).join('\n')}`)
      .join('\n');
    sections.push(`## Earlier (by month)\n${blocks}`);
  }

  const shown = new Set(episodes.map(e => e.id));
  const freshMarks = marks.filter(m => !shown.has(m.id));
  if (freshMarks.length) {
    sections.push(
      `## Milestones (importance ≥ 4)\n${freshMarks
        .map(m => `- ${dayOf(m.occurred_at)} · ${m.project} · ${firstSentence(m.episode?.did?.trim() || m.content)}`)
        .join('\n')}`,
    );
  }

  if (todos.length) {
    sections.push(`## Open todos\n${todos.map(t => `- [${t.project}] ${t.content}`).join('\n')}`);
  }
  if (prefs.length) {
    sections.push(`## Preferences\n${prefs.map(p => `- ${p.content}`).join('\n')}`);
  }

  // Spec §4.1: the closing nudge is what produces the follow-up memory_recall.
  sections.push('Call memory_recall for details on any item.');

  recordEvent({
    kind: 'summary',
    latency_ms: Date.now() - started,
    hits: episodes.length,
    ...(project ? { project } : {}),
  });
  return sections.join('\n\n');
}
