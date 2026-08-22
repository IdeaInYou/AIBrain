import { serve } from '@hono/node-server';
import { config } from './config.js';
import { warmEmbedder } from './embed/embedder.js';
import { logger } from './logger.js';
import { createApp } from './http/app.js';
import { createMcpServer } from './mcp/server.js';
import { assertEmbedDim, ensureIndices } from './search/indices.js';

async function bootstrap(): Promise<void> {
  // Model first: a cold ONNX load takes seconds, and nothing should serve before it.
  await warmEmbedder();
  await ensureIndices();
  await assertEmbedDim(config.EMBED_DIM);

  if (config.MCP_TRANSPORT === 'stdio') {
    const { StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
    logger.info('mcp server listening on stdio');
    return;
  }

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.PORT }, info => {
    logger.info({ port: info.port }, 'memory server listening');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutting down');
      server.close(() => process.exit(0));
    });
  }
}

bootstrap().catch(err => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'bootstrap failed');
  process.exit(1);
});
