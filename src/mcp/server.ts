import { McpServer } from '@modelcontextprotocol/server';
import { SERVER_NAME, SERVER_VERSION } from '../config.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerContextum } from './tools/contextum.js';
import { registerForget } from './tools/forget.js';
import { registerRecall } from './tools/recall.js';
import { registerRemember } from './tools/remember.js';
import { registerSummary } from './tools/summary.js';
import { registerUpdate } from './tools/update.js';

/**
 * A fresh server instance per MCP session. All behavioural guidance lives here —
 * `instructions` plus the tool descriptions — so no client-side prompt is needed.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // Registration order is the order clients list them; summary first is deliberate.
  registerSummary(server);
  registerRecall(server);
  registerRemember(server);
  registerUpdate(server);
  registerForget(server);
  registerContextum(server);

  registerResources(server);
  registerPrompts(server);

  return server;
}
