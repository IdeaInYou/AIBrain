import type { Hono } from 'hono';
import * as z from 'zod';
import { listProjects, patchProject, slugify } from '../../core/projects.js';

const PatchSchema = z.object({
  name: z.string().optional(),
  aliases: z.array(z.string()).max(20).optional(),
  repo_names: z.array(z.string()).max(20).optional(),
});

export function mountProjects(app: Hono): void {
  app.get('/api/projects', async c => {
    const projects = await listProjects();
    return c.json({ projects });
  });

  // Lets the hook teach the server which git remote maps to which slug.
  app.put('/api/projects/:slug', async c => {
    const slug = slugify(c.req.param('slug'));
    if (!slug) return c.json({ error: 'invalid slug' }, 400);

    const parsed = PatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'invalid body', issues: parsed.error.issues.slice(0, 10) }, 400);
    }
    return c.json(await patchProject(slug, parsed.data));
  });
}
