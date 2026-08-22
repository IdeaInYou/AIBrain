import { WebStandardStreamableHTTPServerTransport, type McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { logger } from '../../logger.js';
import { createMcpServer } from '../../mcp/server.js';

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
}

/**
 * Sessions are in-memory by necessity: a Streamable HTTP session owns a live
 * transport and an open SSE stream, neither of which can be rehydrated from a
 * store after a restart. Persisting the ids alone would be worse than useless —
 * the id would resolve but the stream behind it would not exist.
 *
 * So the contract is: a session id we do not know gets a 404, which is the
 * signal MCP clients use to re-initialize. That is what makes a redeploy
 * invisible to Claude Desktop rather than a hard failure.
 */
const sessions = new Map<string, Session>();

/** Sessions are dropped after this long without a request. */
const IDLE_TTL_MS = 60 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

function closeSession(id: string, reason: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  void session.server.close().catch(() => {});
  logger.info({ session: id, reason, open: sessions.size }, 'mcp session closed');
}

// Without this, every connection a client ever opens leaks a transport and an
// McpServer for the lifetime of the process.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - IDLE_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) closeSession(id, 'idle');
  }
}, SWEEP_MS);
sweeper.unref();

async function openSession(): Promise<WebStandardStreamableHTTPServerTransport> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: id => {
      sessions.set(id, { transport, server, lastSeen: Date.now() });
      logger.info({ session: id, open: sessions.size }, 'mcp session opened');
    },
  });

  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) closeSession(id, 'transport closed');
  };

  await server.connect(transport);
  return transport;
}

/** Streamable HTTP: POST sends messages, GET opens the SSE stream, DELETE ends the session. */
export function mountMcp(app: Hono, path = '/mcp'): void {
  app.all(path, async c => {
    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        // Almost always a redeploy: the client is holding an id from the
        // previous process. 404 tells it to start a new session; the SDK's own
        // "Server not initialized" 400 reads as a server fault instead.
        logger.info({ session: sessionId, method: c.req.method }, 'mcp session unknown — asking client to re-initialize');
        return c.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message:
                'Session not found. The server restarted or the session expired — send an initialize request to start a new one.',
            },
            id: null,
          },
          404,
        );
      }
      existing.lastSeen = Date.now();
      return existing.transport.handleRequest(c.req.raw);
    }

    const transport = await openSession();
    return transport.handleRequest(c.req.raw);
  });
}

export function openSessionCount(): number {
  return sessions.size;
}
