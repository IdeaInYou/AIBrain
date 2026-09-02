import { INDEX, config } from '../config.js';
import { osRequest } from '../search/client.js';
import { logger } from '../logger.js';
import type { MemoryType } from '../types.js';

export interface DigestStats {
  period: 'daily' | 'weekly';
  startDate: string;
  endDate: string;
  summary: {
    total: number;
    byType: Record<string, number>;
  };
  highlights: {
    topFacts: Array<{ id: string; content: string; project: string; score: number }>;
    activeDecisions: Array<{ id: string; content: string; project: string }>;
    openTodos: Array<{ id: string; content: string; project: string; deferred?: string }>;
  };
}

/**
 * Generate a digest of memory activity for a given period.
 * Shows what was learned, decided, and what's pending.
 */
export async function generateDigest(
  period: 'daily' | 'weekly' = 'daily'
): Promise<DigestStats> {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0]!;

  const daysBack = period === 'daily' ? 1 : 7;
  const startDate = new Date(now.getTime() - daysBack * 86_400_000)
    .toISOString()
    .split('T')[0]!;

  const range = {
    range: {
      created_at: {
        gte: `${startDate}T00:00:00Z`,
        lte: `${endDate}T23:59:59Z`,
      },
    },
  };

  try {
    // Count by type
    const res = await osRequest<{ aggregations: Record<string, any> }>(
      'POST',
      `/${INDEX.memories}/_search`,
      {
        size: 0,
        query: { bool: { must: [range, { term: { status: 'active' } }] } },
        aggs: {
          byType: { terms: { field: 'type', size: 10 } },
        },
      }
    );

    const byType: Record<string, number> = {};
    const types: MemoryType[] = ['episode', 'decision', 'fact', 'todo', 'preference'];
    for (const type of types) {
      byType[type] = 0;
    }

    for (const bucket of res.aggregations.byType?.buckets ?? []) {
      byType[bucket.key as MemoryType] = bucket.doc_count;
    }

    // Get top facts
    const topFactsRes = await osRequest<{ hits: { hits: any[] } }>(
      'POST',
      `/${INDEX.memories}/_search`,
      {
        size: 3,
        query: {
          bool: {
            must: [
              range,
              { term: { type: 'fact' } },
              { term: { status: 'active' } },
            ],
          },
        },
        sort: [{ importance: { order: 'desc' } }, { created_at: { order: 'desc' } }],
      }
    );

    const topFacts: DigestStats['highlights']['topFacts'] = (topFactsRes.hits?.hits ?? []).map((h: any) => ({
      id: (h._id as string) || '',
      content: (((h._source.content as string) || '').slice(0, 100) as string),
      project: ((h._source.project as string) || 'general') as string,
      score: (h._source.importance as number) || 3,
    }));

    // Get active decisions
    const decisionsRes = await osRequest<{ hits: { hits: any[] } }>(
      'POST',
      `/${INDEX.memories}/_search`,
      {
        size: 3,
        query: {
          bool: {
            must: [
              range,
              { term: { type: 'decision' } },
              { term: { status: 'active' } },
            ],
          },
        },
        sort: [{ created_at: { order: 'desc' } }],
      }
    );

    const activeDecisions: DigestStats['highlights']['activeDecisions'] = (decisionsRes.hits?.hits ?? []).map((h: any) => ({
      id: (h._id as string) || '',
      content: (((h._source.content as string) || '').slice(0, 100) as string),
      project: ((h._source.project as string) || 'general') as string,
    }));

    // Get open todos
    const todosRes = await osRequest<{ hits: { hits: any[] } }>(
      'POST',
      `/${INDEX.memories}/_search`,
      {
        size: 5,
        query: {
          bool: {
            must: [range, { term: { type: 'todo' } }, { term: { status: 'active' } }],
          },
        },
        sort: [{ importance: { order: 'desc' } }, { created_at: { order: 'desc' } }],
      }
    );

    const openTodos = (todosRes.hits?.hits ?? []).map((h: any) => ({
      id: h._id,
      content: h._source.content,
      project: h._source.project,
      deferred: h._source.deferred,
    }));

    const total = Object.values(byType).reduce((a, b) => a + b, 0);

    return {
      period,
      startDate,
      endDate,
      summary: { total, byType: byType as Record<MemoryType, number> },
      highlights: {
        topFacts,
        activeDecisions,
        openTodos,
      },
    };
  } catch (err) {
    logger.error({ err }, 'digest generation failed');
    const emptyStart = new Date().toISOString().split('T')[0]!;
    return {
      period,
      startDate: emptyStart,
      endDate: emptyStart,
      summary: { total: 0, byType: { episode: 0, decision: 0, fact: 0, todo: 0, preference: 0 } },
      highlights: { topFacts: [], activeDecisions: [], openTodos: [] },
    };
  }
}

/**
 * Format digest as markdown for display or export.
 */
export function formatDigest(digest: DigestStats): string {
  const { period, startDate, endDate, summary, highlights } = digest;

  const lines: string[] = [
    `# Memory Digest — ${period === 'daily' ? 'Daily' : 'Weekly'}`,
    `${startDate} to ${endDate}`,
    '',
    '## Summary',
    `**Total records**: ${summary.total}`,
    `- Episodes: ${summary.byType.episode}`,
    `- Decisions: ${summary.byType.decision}`,
    `- Facts: ${summary.byType.fact}`,
    `- Todos: ${summary.byType.todo}`,
    `- Preferences: ${summary.byType.preference}`,
    '',
  ];

  if (highlights.topFacts.length > 0) {
    lines.push('## Top Facts');
    for (const fact of highlights.topFacts) {
      const proj = fact.project || 'general';
      const cont = fact.content || '';
      lines.push(`- **[${proj}]** ${cont}...`);
    }
    lines.push('');
  }

  if (highlights.activeDecisions.length > 0) {
    lines.push('## Key Decisions');
    for (const decision of highlights.activeDecisions) {
      const proj = decision.project || 'general';
      const cont = decision.content || '';
      lines.push(`- **[${proj}]** ${cont}...`);
    }
    lines.push('');
  }

  if (highlights.openTodos.length > 0) {
    lines.push('## Open Todos');
    for (const todo of highlights.openTodos) {
      lines.push(`- **[${todo?.project ?? 'general'}]** ${todo?.content ?? ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
