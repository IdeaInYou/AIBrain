import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/server';
import { allPreferences } from '../core/memory.js';
import { listProjects } from '../core/projects.js';
import { buildSummary } from '../core/summary.js';

export function registerResources(server: McpServer): void {
  // Static, not a template — clients that auto-attach resources can only surface static ones.
  server.registerResource(
    'summary',
    'memory://summary',
    {
      title: 'Memory summary',
      description: 'Cross-project overview. Same content as memory_summary.',
      mimeType: 'text/markdown',
    },
    async uri => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await buildSummary() }],
    }),
  );

  server.registerResource(
    'projects',
    'memory://projects',
    {
      title: 'Projects',
      description: "List of the user's projects with fact counts.",
      mimeType: 'application/json',
    },
    async uri => {
      const projects = await listProjects();
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ projects }, null, 2) }],
      };
    },
  );

  server.registerResource(
    'project-summary',
    new ResourceTemplate('memory://projects/{project}/summary', { list: undefined }),
    {
      title: 'Project summary',
      description: 'Current summary of one project.',
      mimeType: 'text/markdown',
    },
    async (uri, { project }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: await buildSummary({ project: String(project) }),
        },
      ],
    }),
  );

  server.registerResource(
    'preferences',
    'memory://preferences',
    {
      title: 'Preferences',
      description: 'How the user prefers to work and communicate.',
      mimeType: 'text/markdown',
    },
    async uri => {
      const prefs = await allPreferences();
      const text = prefs.length
        ? prefs.map(p => `- ${p.content}`).join('\n')
        : '- (none recorded)';
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );
}
