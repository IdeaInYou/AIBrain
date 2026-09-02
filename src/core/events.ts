import { INDEX, config } from '../config.js';
import { logger } from '../logger.js';
import { osRequest } from '../search/client.js';

export type EventKind = 'recall' | 'summary' | 'pretool' | 'remember' | 'ingest' | 'commit';

/** Deliberately contains no memory content — only shapes and timings. */
export interface MemoryEvent {
  kind: EventKind;
  client?: string | null;
  project?: string | null;
  source_kind?: string | null;
  k?: number;
  hits?: number;
  latency_ms?: number;
  query_len?: number;
  top_score?: number;
  cached?: boolean;
}

/**
 * Fire-and-forget. Metrics must never add latency to, or fail, the operation
 * they measure — so this is deliberately not awaited by callers.
 */
export function recordEvent(event: MemoryEvent): void {
  if (!config.METRICS_ENABLED) return;
  const doc = { ...event, ts: new Date().toISOString() };
  // No refresh: events are aggregated over days, never read back immediately.
  void osRequest('POST', `/${INDEX.events}/_doc`, doc).catch(err => {
    logger.warn({ err: (err as Error).message, kind: event.kind }, 'metrics: write failed');
  });
}

/** Wraps an async call, recording how long it took and how much it returned. */
export async function timed<T>(
  kind: EventKind,
  fn: () => Promise<T>,
  describe: (result: T) => Omit<MemoryEvent, 'kind' | 'latency_ms'>,
): Promise<T> {
  const started = Date.now();
  const result = await fn();
  recordEvent({ kind, latency_ms: Date.now() - started, ...describe(result) });
  return result;
}

export interface Stats {
  days: number;
  recall: {
    total: number;
    per_day: { date: string; count: number }[];
    zero_result: number;
    zero_result_pct: number;
    avg_top_score: number | null;
    p50_latency_ms: number | null;
    p95_latency_ms: number | null;
  };
  pretool: { total: number; hits: number; misses: number; hit_pct: number };
  writes_by_source: { source_kind: string; count: number }[];
  summary_calls: number;
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

/**
 * The number that matters most is `zero_result_pct`: above ~30% means recall is
 * failing, and the fix is usually query wording or missing data — not a reranker.
 */
export async function stats(days: number): Promise<Stats> {
  const range = { range: { ts: { gte: `now-${days}d` } } };

  const res = await osRequest<{
    aggregations: Record<string, any>;
  }>('POST', `/${INDEX.events}/_search`, {
    size: 0,
    query: range,
    aggs: {
      recall: {
        filter: { term: { kind: 'recall' } },
        aggs: {
          per_day: { date_histogram: { field: 'ts', calendar_interval: 'day', format: 'yyyy-MM-dd' } },
          zero: { filter: { term: { hits: 0 } } },
          avg_top: { avg: { field: 'top_score' } },
          latency: { percentiles: { field: 'latency_ms', percents: [50, 95] } },
        },
      },
      pretool: {
        filter: { term: { kind: 'pretool' } },
        aggs: { zero: { filter: { term: { hits: 0 } } } },
      },
      writes: {
        filter: { terms: { kind: ['remember', 'ingest', 'commit'] } },
        aggs: { by_source: { terms: { field: 'source_kind', size: 10 } } },
      },
      summaries: { filter: { term: { kind: 'summary' } } },
    },
  });

  const a = res.aggregations;
  const recallTotal = a.recall?.doc_count ?? 0;
  const recallZero = a.recall?.zero?.doc_count ?? 0;
  const pretoolTotal = a.pretool?.doc_count ?? 0;
  const pretoolZero = a.pretool?.zero?.doc_count ?? 0;

  return {
    days,
    recall: {
      total: recallTotal,
      per_day: (a.recall?.per_day?.buckets ?? []).map((b: any) => ({
        date: b.key_as_string,
        count: b.doc_count,
      })),
      zero_result: recallZero,
      zero_result_pct: pct(recallZero, recallTotal),
      avg_top_score: a.recall?.avg_top?.value ?? null,
      p50_latency_ms: a.recall?.latency?.values?.['50.0'] ?? null,
      p95_latency_ms: a.recall?.latency?.values?.['95.0'] ?? null,
    },
    pretool: {
      total: pretoolTotal,
      hits: pretoolTotal - pretoolZero,
      misses: pretoolZero,
      hit_pct: pct(pretoolTotal - pretoolZero, pretoolTotal),
    },
    writes_by_source: (a.writes?.by_source?.buckets ?? []).map((b: any) => ({
      source_kind: b.key,
      count: b.doc_count,
    })),
    summary_calls: a.summaries?.doc_count ?? 0,
  };
}

/** Quick check for whether semantic reranking should activate (zero_result_pct > threshold). */
export async function getRecentStats(): Promise<{ zero_result_pct: number; total: number }> {
  try {
    const s = await stats(7); // Last 7 days
    return {
      zero_result_pct: s.recall.zero_result_pct,
      total: s.recall.total,
    };
  } catch {
    return { zero_result_pct: 0, total: 0 };
  }
}
