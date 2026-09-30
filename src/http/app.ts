import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { OAUTH, OAUTH_ENABLED, config } from '../config.js';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../oauth/service.js';
import { mountFileContext } from './routes/file-context.js';
import { mountHealth } from './routes/health.js';
import { mountIngest } from './routes/ingest.js';
import { mountMcp } from './routes/mcp.js';
import { mountOAuth } from './routes/oauth.js';
import { mountMaintenance } from './routes/maintenance.js';
import { mountProjects } from './routes/projects.js';
import { mountStats } from './routes/stats.js';
import { mountSummary } from './routes/summary.js';
import { mountDigest } from './routes/digest.js';
import { mountImports } from './routes/imports.js';

/** Constant-time compare so a wrong token cannot be discovered byte by byte. */
function isStaticToken(presented: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(config.MCP_AUTH_TOKEN, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Two credentials are accepted, deliberately:
 *   - the static MCP_AUTH_TOKEN, used by the shell hooks and the REST API
 *   - an OAuth access token, used by claude.ai web/mobile/Desktop connectors
 * Dropping the static one would break every installed hook.
 */
async function authenticate(presented: string): Promise<'static' | 'oauth' | null> {
  if (config.MCP_AUTH_TOKEN && isStaticToken(presented)) return 'static';
  if (OAUTH_ENABLED && (await verifyAccessToken(presented))) return 'oauth';
  return null;
}

export function createApp(): Hono {
  const app = new Hono();

  // Public routes, mounted before the auth middleware.
  mountHealth(app);
  if (OAUTH_ENABLED) mountOAuth(app);

  app.use('*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const kind = presented ? await authenticate(presented) : null;

    if (!kind) {
      logger.warn({ path: c.req.path, method: c.req.method }, 'unauthorized');
      // The WWW-Authenticate pointer is what makes an MCP client discover OAuth
      // instead of simply giving up. Claude does not honour it on a 200.
      const headers: Record<string, string> = OAUTH_ENABLED
        ? { 'WWW-Authenticate': `Bearer resource_metadata="${OAUTH.protectedResourceMetadata}"` }
        : {};
      return c.json({ error: 'unauthorized' }, 401, headers);
    }

    await next();
  });

  mountMcp(app);
  mountIngest(app);
  mountFileContext(app);
  mountSummary(app);
  mountProjects(app);
  mountStats(app);
  mountMaintenance(app);
  mountDigest(app);
  mountImports(app);

  app.onError((err, c) => {
    logger.error({ err: err.message, path: c.req.path }, 'request failed');
    return c.json({ error: err.message }, 500);
  });

  app.notFound(c => c.json({ error: 'not found' }, 404));

  return app;
}
