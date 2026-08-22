/**
 * Re-embeds every memory into a fresh index. Run after changing EMBED_MODEL or
 * EMBED_DIM — the stored vectors are model-specific and cannot be reused.
 *
 *   npm run reindex
 *
 * Reads from the live index and writes to `<memories>-v<timestamp>`, then prints
 * the alias command. Nothing is deleted; swap and drop the old index by hand.
 */
import { INDEX, config } from '../src/config.js';
import { getEmbedder } from '../src/embed/embedder.js';
import { logger } from '../src/logger.js';
import { osRequest } from '../src/search/client.js';
import { memoriesMapping } from '../src/search/indices.js';
import type { MemoryDoc } from '../src/types.js';

const BATCH = 64;
const target = `${INDEX.memories}-v${Date.now()}`;

interface ScrollResponse {
  _scroll_id: string;
  hits: { hits: { _id: string; _source: MemoryDoc }[] };
}

const embedder = await getEmbedder();
await osRequest('PUT', `/${target}`, memoriesMapping(config.EMBED_DIM));
logger.info({ target, model: config.EMBED_MODEL, dim: config.EMBED_DIM }, 'reindex: created target');

let scroll = await osRequest<ScrollResponse>(
  'POST',
  `/${INDEX.memories}/_search`,
  { size: BATCH, query: { match_all: {} }, _source: { excludes: ['embedding'] } },
  { scroll: '5m' },
);

let total = 0;
while (scroll.hits.hits.length > 0) {
  const docs = scroll.hits.hits;
  const vectors = await embedder.embed(
    docs.map(d => d._source.content),
    'passage',
  );

  const lines = docs.flatMap((doc, i) => [
    JSON.stringify({ index: { _index: target, _id: doc._id } }),
    JSON.stringify({ ...doc._source, embedding: vectors[i] }),
  ]);
  await osRequest('POST', '/_bulk', `${lines.join('\n')}\n`);

  total += docs.length;
  logger.info({ total }, 'reindex: progress');

  scroll = await osRequest<ScrollResponse>('POST', '/_search/scroll', {
    scroll: '5m',
    scroll_id: scroll._scroll_id,
  });
}

await osRequest('DELETE', '/_search/scroll', { scroll_id: [scroll._scroll_id] }).catch(() => {});

logger.info({ total, target }, 'reindex complete');
console.log(`
Done: ${total} documents in ${target}

Point the server at it by setting INDEX_PREFIX, or swap in place:
  curl -X POST "$OPENSEARCH_URL/_aliases" -H 'content-type: application/json' -d '{
    "actions": [
      { "remove_index": { "index": "${INDEX.memories}" } },
      { "add": { "index": "${target}", "alias": "${INDEX.memories}" } }
    ]
  }'
`);
