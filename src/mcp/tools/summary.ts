import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { config } from '../../config.js';
import { buildSummary } from '../../core/summary.js';

export const SUMMARY_DESCRIPTION =
  'ALWAYS call this first in a new conversation, before your first response to the user. ' +
  'Returns what the user has been working on recently, their open todos, and their preferences. ' +
  'Takes no arguments. Without this call you do not know what the user is working on. ' +
  'Pass a project name only if the user already named one.';

export function registerSummary(server: McpServer): void {
  server.registerTool(
    'memory_summary',
    {
      description: SUMMARY_DESCRIPTION,
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe('Optional. A project name if the user already mentioned one. Omit otherwise.'),
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe(`Optional. How far back the timeline reaches. Default ${config.SUMMARY_DAYS}.`),
      }),
    },
    async ({ project, days }) => {
      const text = await buildSummary({
        ...(project ? { project } : {}),
        ...(days ? { days } : {}),
      });
      return { content: [{ type: 'text', text }] };
    },
  );
}
