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
  /** Looser than DEDUPE_THRESHOLD on purpose: "about the same thing", not "the same thing". */
  RELATED_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  RELATED_MAX: z.coerce.number().int().positive().max(10).default(5),
  /**
   * memory_forget removes documents outright. Set to `false` to go back to the
   * soft delete (status=deleted, excluded from every query but recoverable),
   * which is the safer default for a tool the model can call on its own.
   */
  FORGET_HARD_DELETE: z
    .string()
    .optional()
    .transform(v => v !== 'false' && v !== '0'),
  /**
   * Cosine at which an existing decision is treated as already covering a
   * deferred item, so no todo is created for it.
   *
   * Calibrated at 0.75, not 0.8: measured against real data, "Rotate the auth
   * token before launch." against the decision that settled it scores 0.764,
   * while an unrelated deferred item scores 0.507. A short todo compared to a
   * longer decision sentence dilutes cosine, so 0.8 never fires in practice.
   */
  TODO_DECISION_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  /**
   * Cosine at which a new deferred todo replaces an open todo from an earlier
   * session. Measured on 73 live todos: restatements of the same open item
   * scored 0.83–0.87, distinct items sharing a subsystem mostly below 0.85.
   */
  TODO_MERGE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  /** Metrics are cheap but not free; turn off if the write volume ever matters. */
  METRICS_ENABLED: z
    .string()
    .optional()
    .transform(v => v !== 'false' && v !== '0'),

  /**
   * External origin, e.g. https://memory.example.com. OAuth is enabled only when
   * this is set: every discovery document has to advertise absolute URLs, and
   * guessing them from the request Host header is spoofable.
   */
  PUBLIC_URL: z
    .url()
    .optional()
    .transform(v => v?.replace(/\/+$/, '')),
  /** Password for the OAuth consent screen. Falls back to MCP_AUTH_TOKEN. */
  OAUTH_PASSWORD: z.string().optional(),
  OAUTH_ACCESS_TTL: z.coerce.number().int().positive().default(3600),
  OAUTH_REFRESH_TTL: z.coerce.number().int().positive().default(30 * 24 * 3600),
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
  oauth: `${config.INDEX_PREFIX}oauth`,
  events: `${config.INDEX_PREFIX}events`,
} as const;

/**
 * OAuth is what makes claude.ai web and mobile possible — those surfaces reach
 * the server from Anthropic's cloud and cannot carry a locally-configured
 * header. Without PUBLIC_URL the server stays static-bearer only.
 */
export const OAUTH_ENABLED = Boolean(config.PUBLIC_URL);

export const oauthPassword = (): string => config.OAUTH_PASSWORD || config.MCP_AUTH_TOKEN;

export const OAUTH = {
  issuer: config.PUBLIC_URL ?? '',
  /** Must match the URL the user types into the connector dialog, path included. */
  resource: `${config.PUBLIC_URL ?? ''}/mcp`,
  authorizationEndpoint: `${config.PUBLIC_URL ?? ''}/oauth/authorize`,
  tokenEndpoint: `${config.PUBLIC_URL ?? ''}/oauth/token`,
  registrationEndpoint: `${config.PUBLIC_URL ?? ''}/oauth/register`,
  protectedResourceMetadata: `${config.PUBLIC_URL ?? ''}/.well-known/oauth-protected-resource`,
  scopes: ['mcp', 'offline_access'] as const,
} as const;

export const SEARCH_PIPELINE = `${config.INDEX_PREFIX}hybrid-rrf`;

export const SERVER_NAME = 'memory';
export const SERVER_VERSION = '1.0.0';

export const LIMITS = {
  contentChars: 2000,
  /** Full note markdown — large, but never indexed or embedded. */
  noteChars: 20_000,
  maxRefs: 20,
  recallK: 30,
  ingestBytes: 2 * 1024 * 1024,
  ingestFacts: 500,
  /** Sessions shorter than this are not worth a journal entry. */
  minEpisodeChars: 40,
  /** Project brief — shown at every SessionStart, so it has to stay short. */
  briefChars: 1500,
} as const;
