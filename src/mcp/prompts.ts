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

  server.registerPrompt(
    'contextum_guide',
    {
      description:
        'Guidance on using Contextum coordination center with AIBrain memory for multi-agent repositories.',
      argsSchema: z.object({
        root: z.string().describe('Repository root path (where .contextum/ is located)'),
      }),
    },
    async ({ root }) => {
      const { ContextumBridge } = await import('../mcp/tools/contextum.js');
      const bridge = new ContextumBridge({ root: String(root) });
      const status = await bridge.getStatus();
      const files = status.initialized ? await bridge.listFiles() : [];

      const guide = `# Contextum + AIBrain Integration Guide

## Current status
${
  status.initialized
    ? `✅ Contextum coordination center found in ${root}/.contextum/
- Coordination files: ${files.length} file(s)
- Has agents config: ${status.hasAgents ? 'yes' : 'no'}
- Has context files: ${status.hasContext ? 'yes' : 'no'}`
    : `❌ No Contextum coordination center found in ${root}/.contextum/
Run \`contextum setup\` to initialize multi-agent coordination`
}

## How to use together

1. **Before editing a file**, check if another agent has it locked:
   \`\`\`
   contextum_search(root="${root}", type="tasks", query="<filename>")
   \`\`\`

2. **When starting work**, understand the current agent state:
   \`\`\`
   contextum_search(root="${root}", type="agents")
   \`\`\`

3. **Combine with AIBrain recall** for full context:
   - memory_recall for historical decisions and patterns
   - contextum_search for current coordination state
   - Together: "What was decided about this before, and who is working on it now?"

4. **Record handoffs** - when you complete a task, update Contextum state so the next agent knows what happened

## Files in Contextum center
${
  files.length > 0
    ? files.map((f) => `- ${f.path} (${f.type})`).join('\n')
    : '(no files yet)'
}`;

      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: guide },
          },
        ],
      };
    },
  );
}
