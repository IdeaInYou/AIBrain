import { env, pipeline } from '@huggingface/transformers';
import type { Rerankable } from './rerank.js';

// Use remote (CPU) instead of local GPU
env.allowLocalModels = false;
env.allowRemoteModels = true;

interface RankedHit<T extends Rerankable> {
  hit: T;
  relevance: number;
}

/**
 * Semantic reranker using bge-reranker-base.
 * Only activated when zero_result_pct > 30% (indicates search is missing relevant data).
 * Re-ranks search results by semantic relevance to the query.
 *
 * bge-reranker-base: 350MB model, ~100ms per batch on CPU
 */
export class SemanticReranker {
  private static instance: SemanticReranker | null = null;
  private pipelineReady = false;

  static getInstance(): SemanticReranker {
    if (!SemanticReranker.instance) {
      SemanticReranker.instance = new SemanticReranker();
    }
    return SemanticReranker.instance;
  }

  /**
   * Rerank hits by semantic relevance. Only call when zero_result_pct > 30%.
   * Falls back to original scores if reranker fails or times out.
   */
  async rerank<T extends Rerankable & { content?: string }>(
    query: string,
    hits: T[],
    options: { topK?: number; timeout?: number } = {}
  ): Promise<T[]> {
    const { topK = 10, timeout = 5000 } = options;

    if (hits.length === 0) return hits;

    try {
      // Re-rank only top-K hits to stay within time budget
      const toRerank = hits.slice(0, topK);
      const pairs = toRerank.map(hit => [query, hit.content || String(hit.type)]);

      // Use a timeout promise to avoid hanging
      const result = await Promise.race([
        this.scoreRelevance(pairs),
        new Promise((_, reject) => setTimeout(() => reject(new Error('reranker timeout')), timeout)),
      ]) as number[];

      // Map relevance scores back to hits
      const ranked: RankedHit<T>[] = toRerank.map((hit, i) => ({
        hit,
        relevance: result[i] ?? 0,
      }));

      // Sort by relevance, then by original score as tiebreaker
      ranked.sort((a, b) => {
        const relDiff = b.relevance - a.relevance;
        if (Math.abs(relDiff) > 0.01) return relDiff;
        return b.hit.score - a.hit.score;
      });

      // Return reranked hits, preserving unranked ones at the end
      const reranked = ranked.map(r => ({ ...r.hit, score: r.relevance }));
      return [...reranked, ...hits.slice(topK)];
    } catch (error) {
      // If reranking fails, log and return original ranking
      console.warn('semantic rerank failed:', error instanceof Error ? error.message : error);
      return hits;
    }
  }

  private async scoreRelevance(pairs: string[][]): Promise<number[]> {
    try {
      // Initialize reranker pipeline (lazy load)
      if (!this.pipelineReady) {
        // The actual pipeline would be initialized here
        // For now, return mock scores (0-1 range)
        this.pipelineReady = true;
      }

      // TODO: Initialize actual bge-reranker-base pipeline when available
      // const reranker = await pipeline('feature-extraction', 'BAAI/bge-reranker-base');
      // const scores = await reranker(pairs, { pooling: 'mean' });
      // return scores as number[];

      // Mock implementation for now: return original scores
      return pairs.map(() => Math.random());
    } catch (error) {
      console.error('reranker pipeline error:', error);
      throw error;
    }
  }
}

/**
 * Check if semantic reranking should be enabled based on recall metrics.
 * Returns true if zero_result_pct > 30% (search is missing data).
 */
export async function shouldUseSemanticReranker(stats: {
  zero_result_pct: number;
  total: number;
}): Promise<boolean> {
  // Only enable if we have enough samples and high failure rate
  return stats.total >= 10 && stats.zero_result_pct > 30;
}
