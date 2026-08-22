import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { LIMITS } from '../../config.js';
import { updateMemory } from '../../core/memory.js';
import { MEMORY_TYPES } from '../../types.js';

export const UPDATE_DESCRIPTION =
  'Correct or refine an existing memory by id. Use when the user says something previously ' +
  'stored is wrong or has changed, or to mark a todo done with status: "done".';

export function registerUpdate(server: McpServer): void {
  server.registerTool(
    'memory_update',
    {
      description: UPDATE_DESCRIPTION,
      inputSchema: z.object({
        id: z.string().describe('The id returned by memory_recall.'),
        content: z.string().max(LIMITS.contentChars).optional().describe('In English. Replacement text.'),
        type: z.enum(MEMORY_TYPES).optional(),
        tags: z.array(z.string()).max(6).optional(),
        importance: z.number().int().min(1).max(5).optional(),
        status: z
          .enum(['active', 'done'])
          .optional()
          .describe('Set "done" to close a todo. The memory stays searchable.'),
      }),
    },
    async args => {
      const result = await updateMemory(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
