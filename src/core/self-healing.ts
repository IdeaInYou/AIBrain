import { INDEX, config } from '../config.js';
import { osRequest } from '../search/client.js';
import { logger } from '../logger.js';
import { cosine } from '../search/dedupe.js';
import type { MemoryDoc } from '../types.js';

export interface HealingResult {
  checked: number;
  merged: number;
  superseded: number;
  errors: string[];
}

/**
 * Self-healing: find and fix accidental duplicates that slipped through dedupe.
 * Runs as a background task, merges on high cosine similarity (>0.95).
 * Never deletes — supersedes with status='superseded'.
 */
export async function healDuplicates(maxIterations = 100): Promise<HealingResult> {
  const result: HealingResult = {
    checked: 0,
    merged: 0,
    superseded: 0,
    errors: [],
  };

  try {
    // Find records with same project and type (candidates for duplication)
    const duplicateRes = await osRequest<{
      aggregations: {
        by_project_type: {
          buckets: Array<{
            key: { project: string; type: string };
            doc_count: number;
            docs: { hits: { hits: any[] } };
          }>;
        };
      };
    }>('POST', `/${INDEX.memories}/_search`, {
      size: 0,
      query: { term: { status: 'active' } },
      aggs: {
        by_project_type: {
          composite: {
            sources: [
              { project: { terms: { field: 'project' } } },
              { type: { terms: { field: 'type' } } },
            ],
            size: 100,
          },
          aggs: {
            docs: {
              top_hits: { size: 100, _source: ['content', 'embedding'] },
            },
          },
        },
      },
    });

    for (const bucket of duplicateRes.aggregations?.by_project_type?.buckets ?? []) {
      if (result.checked >= maxIterations) break;

      const { project, type } = bucket.key;
      const hits = bucket.docs?.hits?.hits ?? [];

      if (hits.length < 2) continue;

      // Compare each pair
      for (let i = 0; i < hits.length - 1; i++) {
        for (let j = i + 1; j < hits.length; j++) {
          result.checked++;

          const doc1 = hits[i]._source as MemoryDoc;
          const doc2 = hits[j]._source as MemoryDoc;
          const id1 = hits[i]._id;
          const id2 = hits[j]._id;

          // Skip if either is already superseded
          if (doc1.status === 'superseded' || doc2.status === 'superseded') continue;

          // Cosine similarity between embeddings
          const sim = cosine(doc1.embedding, doc2.embedding);

          // Very high cosine = likely duplicate
          if (sim > 0.95) {
            // Keep the newer one, supersede the older
            const newer = new Date(doc1.created_at) > new Date(doc2.created_at) ? id1 : id2;
            const older = newer === id1 ? id2 : id1;

            try {
              await osRequest('POST', `/${INDEX.memories}/_update/${older}`, {
                doc: { status: 'superseded', superseded_by: newer },
              });

              result.superseded++;
            } catch (err) {
              result.errors.push(
                `Failed to supersede ${older}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          }
        }
      }
    }

    result.merged = result.superseded; // In this context, superseding = resolving
    return result;
  } catch (err) {
    result.errors.push(`Healing scan failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error({ err }, 'self-healing failed');
    return result;
  }
}

/**
 * Schedule a background healing task.
 * Call periodically (e.g., every 24h) to catch edge-case duplicates.
 */
export async function scheduleHealing(): Promise<void> {
  if (!config.METRICS_ENABLED) return; // Use metrics flag to gate healing

  setImmediate(async () => {
    try {
      const result = await healDuplicates(50);
      if (result.superseded > 0 || result.errors.length > 0) {
        logger.info(result, 'self-healing complete');
      }
    } catch (err) {
      logger.warn({ err }, 'background healing failed');
    }
  });
}
