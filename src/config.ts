import { existsSync } from 'node:fs';
import * as z from 'zod';

// Node 22 loads a .env without a dependency. Docker passes env directly.
if (existsSync('.env')) process.loadEnvFile('.env');

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  MCP_TRANSPORT: z.enum(['http', 'stdio']).default('http'),
  MCP_AUTH_TOKEN: z.string().default(''),

  OPENSEARCH_URL: z.url().default('http://localhost:9200'),
  INDEX_PREFIX: z.string().default(''),

  EMBED_MODEL: z.string().default('BAAI/bge-base-en-v1.5'),
  EMBED_DIM: z.coerce.number().int().positive().default(768),
  MODEL_CACHE_DIR: z.string().default('/models'),
  /** fp32 keeps quality; q8 quarters the memory footprint. */
  EMBED_DTYPE: z.enum(['fp32', 'fp16', 'q8', 'int8', 'uint8', 'q4']).default('fp32'),

  DEDUPE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  SUMMARY_DAYS: z.coerce.number().int().positive().default(30),
  SUMMARY_MAX_EPISODES: z.coerce.number().int().positive().default(15),
  RECALL_DEFAULT_K: z.coerce.number().int().positive().default(8),
  DEFAULT_PROJECT: z.string().default('general'),
});

export type Config = z.infer<typeof Schema>;

function load(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(i => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  if (cfg.MCP_TRANSPORT === 'http' && !cfg.MCP_AUTH_TOKEN) {
    throw new Error('Invalid configuration:\n  MCP_AUTH_TOKEN: required when MCP_TRANSPORT=http');
  }
  return cfg;
}

export const config = load();

/** Prefixed so several deployments can share one cluster. */
export const INDEX = {
  memories: `${config.INDEX_PREFIX}memories`,
  projects: `${config.INDEX_PREFIX}projects`,
} as const;

export const SEARCH_PIPELINE = `${config.INDEX_PREFIX}hybrid-rrf`;

export const SERVER_NAME = 'memory';
export const SERVER_VERSION = '1.0.0';

export const LIMITS = {
  contentChars: 2000,
  recallK: 30,
  ingestBytes: 2 * 1024 * 1024,
  ingestFacts: 500,
  /** Sessions shorter than this are not worth a journal entry. */
  minEpisodeChars: 40,
} as const;
