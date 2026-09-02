import { Hono } from 'hono';
import { healDuplicates, scheduleHealing } from '../../core/self-healing.js';
import { logger } from '../../logger.js';

export function mountSelfHealing(app: Hono): void {
  app.post('/api/self-healing/trigger', async c => {
    try {
      const body = await c.req.json<{ maxIterations?: number }>();
      const maxIterations = body.maxIterations ?? 100;

      const result = await healDuplicates(maxIterations);
      logger.info(result, 'self-healing triggered');
      return c.json(result);
    } catch (err) {
      logger.error({ err }, 'self-healing failed');
      throw err;
    }
  });

  app.post('/api/self-healing/schedule', async c => {
    try {
      await scheduleHealing();
      logger.info('self-healing scheduled');
      return c.json({ status: 'scheduled' });
    } catch (err) {
      logger.error({ err }, 'scheduling self-healing failed');
      throw err;
    }
  });

  app.get('/api/self-healing/status', async c => {
    return c.json({
      status: 'ready',
      threshold: 0.95,
      gatedBy: 'METRICS_ENABLED',
      description: 'Detects duplicates with cosine similarity > 0.95, supersedes older with newer',
    });
  });
}
