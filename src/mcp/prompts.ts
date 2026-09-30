import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { buildSummary } from '../core/summary.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';

/** Spec §6: memory_summary output plus the rules from §3, verbatim. */
export async function buildStartSessionText(project?: string): Promise<string> {
  const summary = await buildSummary(project ? { project } : {});
  return `${summary}\n\n---\n\n${SERVER_INSTRUCTIONS}`;
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'start_session',
    {
      description: 'Load long-term memory context for this conversation. Optional project name.',
      argsSchema: z.object({
        project: z.string().optional().describe('Optional project name.'),
      }),
    },
    async ({ project }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: await buildStartSessionText(project) },
        },
      ],
    }),
  );
}
