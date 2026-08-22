import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import { assertEmbedDim, ensureIndices } from '../src/search/indices.js';

const result = await ensureIndices();
await assertEmbedDim(config.EMBED_DIM);
logger.info({ result, dim: config.EMBED_DIM }, 'init-index done');
