import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { LIMITS } from '../../config.js';
import { recall } from '../../core/memory.js';
import { MEMORY_TYPES } from '../../types.js';

export const RECALL_DESCRIPTION =
  "Search the user's long-term memory. REQUIRED before answering any question about " +
  'their projects, codebase, architecture, infrastructure, business, past decisions, or ' +
  'preferences — even if you believe you already know the answer. ' +
  'Query must be in English; translate the user\'s question if needed. ' +
  'Searches across all projects by default; the project filter is optional.';

export function registerRecall(server: McpServer): void {
  server.registerTool(
    'memory_recall',
    {
      description: RECALL_DESCRIPTION,
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "In English. What you want to know, phrased like the user's question. Include specific names (services, libraries, features).",
          ),
        project: z
          .string()
          .optional()
          .describe('Optional project filter. Omit if unsure — each result includes its project.'),
        type: z
          .array(z.enum(MEMORY_TYPES))
          .optional()
          .describe('Optional. Restrict to memory types. episode = a past work session.'),
        since: z
          .string()
          .optional()
          .describe("Optional. ISO date or relative like '30d'. Use for 'recent' questions."),
        k: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.recallK)
          .optional()
          .describe('Number of results. Default 8.'),
      }),
    },
    async args => {
      const hits = await recall(args);
      if (hits.length === 0) {
        return { content: [{ type: 'text', text: 'No matching memories. Say so rather than guessing.' }] };
      }
      const results = hits.map(h => ({
        id: h.id,
        project: h.project,
        type: h.type,
        content: h.content,
        ...(h.episode ? { episode: h.episode } : {}),
        occurred_at: h.occurred_at,
        score: Number(h.score.toFixed(4)),
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }] };
    },
  );
}
