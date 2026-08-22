import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { mountHealth } from './routes/health.js';
import { mountIngest } from './routes/ingest.js';
import { mountMcp } from './routes/mcp.js';
import { mountProjects } from './routes/projects.js';
import { mountSummary } from './routes/summary.js';

/** Constant-time compare so a wrong token cannot be discovered byte by byte. */
function tokenMatches(presented: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(config.MCP_AUTH_TOKEN, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(): Hono {
  const app = new Hono();

  // /health stays open so Docker and Traefik can probe without the secret.
  mountHealth(app);

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!presented || !tokenMatches(presented)) {
      logger.warn({ path: c.req.path, method: c.req.method }, 'unauthorized');
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  mountMcp(app);
  mountIngest(app);
  mountSummary(app);
  mountProjects(app);

  app.onError((err, c) => {
    logger.error({ err: err.message, path: c.req.path }, 'request failed');
    return c.json({ error: err.message }, 500);
  });

  app.notFound(c => c.json({ error: 'not found' }, 404));

  return app;
}
