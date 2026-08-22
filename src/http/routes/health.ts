import type { Hono } from 'hono';
import { embedderReady } from '../../embed/embedder.js';
import { clusterHealth } from '../../search/client.js';
import { openSessionCount } from './mcp.js';

/** The only unauthenticated route. Reports OpenSearch reachability and model readiness. */
export function mountHealth(app: Hono): void {
  app.get('/health', async c => {
    const embedder = embedderReady();
    try {
      const cluster = await clusterHealth();
      const ok = cluster.status !== 'red' && embedder;
      return c.json(
        { status: ok ? 'ok' : 'degraded', opensearch: cluster.status, embedder: embedder ? 'ready' : 'loading', mcp_sessions: openSessionCount() },
        ok ? 200 : 503,
      );
    } catch (err) {
      return c.json(
        { status: 'down', opensearch: 'unreachable', embedder: embedder ? 'ready' : 'loading', error: (err as Error).message },
        503,
      );
    }
  });
}
