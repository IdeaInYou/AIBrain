import { createHash, randomBytes } from 'node:crypto';
import { INDEX } from '../config.js';
import { logger } from '../logger.js';
import { osRequest, statusOf } from '../search/client.js';

/**
 * OAuth state lives in OpenSearch rather than memory so a redeploy does not
 * silently sign every device out.
 */
export type OAuthKind = 'client' | 'code' | 'access' | 'refresh';

export interface OAuthRecord {
  kind: OAuthKind;
  client_id: string;
  client_name?: string;
  redirect_uris?: string[];
  /** code records only */
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  resource?: string;
  /** token records only — ties an access token to the refresh that minted it */
  family?: string;
  created_at: string;
  expires_at?: string;
}

/** Secrets are stored hashed: a dump of the index must not be replayable. */
export const hashSecret = (raw: string): string => createHash('sha256').update(raw, 'utf8').digest('hex');

export const newSecret = (): string => randomBytes(32).toString('base64url');

export const newClientId = (): string => `mcp_${randomBytes(12).toString('hex')}`;

const docId = (kind: OAuthKind, key: string) => `${kind}:${key}`;

export async function put(kind: OAuthKind, key: string, record: OAuthRecord): Promise<void> {
  await osRequest('PUT', `/${INDEX.oauth}/_doc/${encodeURIComponent(docId(kind, key))}`, record, {
    refresh: 'wait_for',
  });
}

export async function get(kind: OAuthKind, key: string): Promise<OAuthRecord | null> {
  try {
    const res = await osRequest<{ _source: OAuthRecord }>(
      'GET',
      `/${INDEX.oauth}/_doc/${encodeURIComponent(docId(kind, key))}`,
    );
    return res._source;
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

export async function drop(kind: OAuthKind, key: string): Promise<void> {
  try {
    await osRequest('DELETE', `/${INDEX.oauth}/_doc/${encodeURIComponent(docId(kind, key))}`, undefined, {
      refresh: 'wait_for',
    });
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }
}

/** Revokes every token minted from one authorization — used on refresh reuse. */
export async function dropFamily(family: string): Promise<number> {
  const res = await osRequest<{ deleted: number }>(
    'POST',
    `/${INDEX.oauth}/_delete_by_query`,
    { query: { bool: { filter: [{ term: { family } }] } } },
    { refresh: 'true', conflicts: 'proceed' },
  );
  return res.deleted;
}

export function isExpired(record: OAuthRecord, now = Date.now()): boolean {
  if (!record.expires_at) return false;
  const at = Date.parse(record.expires_at);
  return Number.isNaN(at) ? true : at <= now;
}

/** Best-effort sweep at boot; expiry is always re-checked on read as well. */
export async function purgeExpired(): Promise<number> {
  try {
    const res = await osRequest<{ deleted: number }>(
      'POST',
      `/${INDEX.oauth}/_delete_by_query`,
      { query: { range: { expires_at: { lt: 'now' } } } },
      { conflicts: 'proceed' },
    );
    if (res.deleted) logger.info({ deleted: res.deleted }, 'oauth: purged expired records');
    return res.deleted;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'oauth: purge failed');
    return 0;
  }
}
