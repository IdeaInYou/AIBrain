import { ResourceNotFoundError, ResourceTemplate, type McpServer } from '@modelcontextprotocol/server';
import { allPreferences, getNote } from '../core/memory.js';
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

  // Gives claude.ai and mobile the full note without needing the repo checked out.
  server.registerResource(
    'note',
    new ResourceTemplate('memory://notes/{id}', { list: undefined }),
    {
      title: 'Session or decision note',
      description: 'Full markdown of the note behind a memory. Read when refs point at a file you cannot open.',
      mimeType: 'text/markdown',
    },
    async (uri, { id }) => {
      const found = await getNote(String(id));
      if (!found) throw new ResourceNotFoundError(uri.href);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: found.note }] };
    },
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

  // Contextum coordination center status (for multi-agent repos)
  server.registerResource(
    'contextum-status',
    new ResourceTemplate('memory://contextum/{root}/status', { list: undefined }),
    {
      title: 'Contextum coordination status',
      description: 'Shows if .contextum/ coordination center exists and what state is active.',
      mimeType: 'application/json',
    },
    async (uri, { root }) => {
      const { ContextumBridge } = await import('../mcp/tools/contextum.js');
      const bridge = new ContextumBridge({ root: String(root) });
      const status = await bridge.getStatus();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                contextum_initialized: status.initialized,
                has_agents: status.hasAgents,
                has_context: status.hasContext,
                message: status.initialized
                  ? 'Multi-agent coordination center found — use contextum_search to check locks and tasks'
                  : 'No Contextum coordination center in this repository',
              },
              null,
              2
            ),
          },
        ],
      };
    },
  );
}
