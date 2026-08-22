import type { Hono } from 'hono';
import { config } from '../../config.js';
import { stats } from '../../core/events.js';

export function mountStats(app: Hono): void {
  app.get('/api/stats', async c => {
    if (!config.METRICS_ENABLED) return c.json({ error: 'metrics are disabled' }, 503);

    const raw = Number(c.req.query('days'));
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 365) : 7;

    const result = await stats(days);

    // A high zero-result rate is the signal that recall is failing — surface it
    // as a verdict rather than leaving it to be spotted in the numbers.
    const warnings: string[] = [];
    if (result.recall.total >= 10 && result.recall.zero_result_pct > 30) {
      warnings.push(
        `${result.recall.zero_result_pct}% of recalls returned nothing — check query wording and whether the data exists before tuning search.`,
      );
    }
    if (result.pretool.total >= 10 && result.pretool.hit_pct < 20) {
      warnings.push(
        `pre-tool recall hits only ${result.pretool.hit_pct}% of the time — episode.files may not be capturing the files actually edited.`,
      );
    }

    return c.json({ ...result, warnings });
  });
}
