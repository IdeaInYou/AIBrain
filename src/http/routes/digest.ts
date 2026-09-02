import { Hono } from 'hono';
import { generateDigest, formatDigest } from '../../core/digest.js';
import { logger } from '../../logger.js';

export function mountDigest(app: Hono): void {
  app.post('/api/digest', async c => {
    try {
      const body = await c.req.json<{ period?: 'daily' | 'weekly' }>();
      const period = body.period ?? 'daily';

      const digest = await generateDigest(period);
      const formatted = formatDigest(digest);

      logger.info({ period, total: digest.summary.total }, 'digest generated');
      return c.json({ digest, formatted });
    } catch (err) {
      logger.error({ err }, 'digest generation failed');
      throw err;
    }
  });

  app.get('/api/digest', async c => {
    try {
      const period = (c.req.query('period') ?? 'daily') as 'daily' | 'weekly';
      const digest = await generateDigest(period);
      return c.json(digest);
    } catch (err) {
      logger.error({ err }, 'digest generation failed');
      throw err;
    }
  });
}
