import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { forget } from '../../core/memory.js';
import { MEMORY_TYPES } from '../../types.js';

export const FORGET_DESCRIPTION =
  'Remove a memory by id, or by filter. Use only when the user explicitly asks to forget something.';

export function registerForget(server: McpServer): void {
  server.registerTool(
    'memory_forget',
    {
      description: FORGET_DESCRIPTION,
      inputSchema: z.object({
        id: z.string().optional().describe('The id returned by memory_recall. Prefer this over filter.'),
        filter: z
          .object({
            project: z.string().optional(),
            type: z.array(z.enum(MEMORY_TYPES)).optional(),
            tags: z.array(z.string()).optional(),
            before: z.string().optional().describe("ISO date or relative like '90d'."),
          })
          .optional()
          .describe('Bulk removal. Only when the user asked for exactly this.'),
        reason: z.string().optional(),
      }),
    },
    async args => {
      const result = await forget(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
