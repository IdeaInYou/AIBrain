import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { EmbedKind, Embedder } from './embedder.js';

/** Recommended retrieval instruction for the bge-*-en-v1.5 family. */
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** Batch size for bulk ingest; keeps peak memory flat on a 2 vCPU box. */
const BATCH = 16;

class LocalEmbedder implements Embedder {
  readonly id = `local:${config.EMBED_MODEL}`;
  readonly dim = config.EMBED_DIM;

  constructor(private readonly extractor: FeatureExtractionPipeline) {}

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    const input = kind === 'query' ? texts.map(t => `${QUERY_PREFIX}${t}`) : texts;

    const out: number[][] = [];
    for (let i = 0; i < input.length; i += BATCH) {
      const tensor = await this.extractor(input.slice(i, i + BATCH), {
        pooling: 'cls',
        normalize: true,
      });
      out.push(...(tensor.tolist() as number[][]));
    }

    const width = out[0]?.length;
    if (width !== undefined && width !== this.dim) {
      throw new Error(`${config.EMBED_MODEL} produced ${width}-dim vectors but EMBED_DIM=${this.dim}`);
    }
    return out;
  }
}

export async function createLocalEmbedder(): Promise<Embedder> {
  const started = Date.now();
  logger.info({ model: config.EMBED_MODEL, dtype: config.EMBED_DTYPE }, 'loading embedding model');

  // The library otherwise also tries a second cache under node_modules, which
  // the container cannot write to (runs as `node`, /app is root-owned) and which
  // would not survive a redeploy anyway. MODEL_CACHE_DIR is the volume.
  env.cacheDir = config.MODEL_CACHE_DIR;
  env.useBrowserCache = false;

  // First boot downloads from huggingface.co into MODEL_CACHE_DIR; later boots are offline.
  const extractor = await pipeline('feature-extraction', config.EMBED_MODEL, {
    cache_dir: config.MODEL_CACHE_DIR,
    dtype: config.EMBED_DTYPE,
  });

  logger.info({ ms: Date.now() - started }, 'embedding model ready');
  return new LocalEmbedder(extractor);
}
