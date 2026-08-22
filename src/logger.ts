import { destination, pino } from 'pino';

// Reads env directly rather than importing config.ts — config failures need to be loggable.
const level = process.env.LOG_LEVEL ?? 'info';

// The stdio transport speaks JSON-RPC on stdout, so logs must go to stderr there.
const fd = process.env.MCP_TRANSPORT === 'stdio' ? 2 : 1;

export const logger = pino(
  {
    level,
    // Memory content is user data: ids and counters at info, never the text.
    redact: {
      paths: ['content', '*.content', 'did', '*.did', 'transcript', '*.transcript', 'req.headers.authorization'],
      censor: '[redacted]',
    },
  },
  destination({ fd, sync: false }),
);
