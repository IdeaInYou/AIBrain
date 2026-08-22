import { WebStandardStreamableHTTPServerTransport, type McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { logger } from '../../logger.js';
import { createMcpServer } from '../../mcp/server.js';

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, Session>();

async function openSession(): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: id => {
      sessions.set(id, { transport, server });
      logger.info({ session: id, open: sessions.size }, 'mcp session opened');
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id && sessions.delete(id)) {
      void server.close();
      logger.info({ session: id, open: sessions.size }, 'mcp session closed');
    }
  };

  await server.connect(transport);
  return transport;
}

/** Streamable HTTP: POST sends messages, GET opens the SSE stream, DELETE ends the session. */
export function mountMcp(app: Hono, path = '/mcp'): void {
  app.all(path, async c => {
    const sessionId = c.req.header('mcp-session-id');
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    const transport = existing?.transport ?? (await openSession());
    return transport.handleRequest(c.req.raw);
  });
}

export function openSessionCount(): number {
  return sessions.size;
}
