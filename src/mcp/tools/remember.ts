import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { LIMITS } from '../../config.js';
import { remember } from '../../core/remember.js';
import { MEMORY_TYPES } from '../../types.js';

export const REMEMBER_DESCRIPTION =
  "Store a durable fact in the user's long-term memory. Call IMMEDIATELY when the user " +
  'states a decision, a preference, a fact about their systems or company, or an open todo. ' +
  'Do not ask permission and do not wait to be told to remember. One call per fact. ' +
  'content must be in English — translate it, keeping identifiers and error messages verbatim.';

export function registerRemember(server: McpServer): void {
  server.registerTool(
    'memory_remember',
    {
      description: REMEMBER_DESCRIPTION,
      inputSchema: z.object({
        content: z
          .string()
          .max(LIMITS.contentChars)
          .optional()
          .describe(
            "In English. One self-contained sentence, understandable without the conversation. Name the project/system explicitly, no pronouns like 'it' or 'this'. Required unless type is episode.",
          ),
        type: z
          .enum(MEMORY_TYPES)
          .describe(
            'decision = a choice made; preference = how the user likes to work; fact = stable truth about a system/business; todo = open item; episode = a work session (what was done, why, outcome)',
          ),
        project: z.string().optional().describe('Omit if unsure; defaults to general.'),
        tags: z.array(z.string()).max(6).optional(),
        importance: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('1 = trivia, 3 = default, 5 = architectural/business-critical'),
        episode: z
          .object({
            did: z.string().describe('1–2 sentences: what was actually done or investigated.'),
            why: z.string().default('').describe('1 sentence: the reason or trigger.'),
            outcome: z.string().default('').describe('1 sentence: result — fixed / partially / blocked / decided.'),
            deferred: z.string().default('').describe('1 sentence or empty: what was explicitly postponed.'),
            files: z.array(z.string()).max(10).default([]).describe('Paths touched, if any.'),
          })
          .optional()
          .describe('Required when type is episode. All fields in English.'),
        occurred_at: z
          .string()
          .optional()
          .describe('Optional ISO date of when this happened. Defaults to now — set it only for past events.'),
      }),
    },
    async args => {
      const result = await remember({ ...args, source: { kind: 'tool', client: null, device: null, session_id: null } });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
