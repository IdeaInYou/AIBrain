import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config, oauthPassword } from '../config.js';
import { logger } from '../logger.js';
import {
  drop,
  dropFamily,
  get,
  hashSecret,
  isExpired,
  newSecret,
  put,
  type OAuthRecord,
} from './store.js';

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const CODE_TTL_MS = 60_000; // RFC 6749 §4.1.2: authorization codes are short-lived
const iso = (ms: number) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ PKCE */

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method !== 'S256') return false;
  const computed = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* --------------------------------------------------------- redirect URIs */

function isLoopback(u: URL): boolean {
  return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
}

/**
 * Claude Code is a native client and uses an RFC 8252 loopback redirect on an
 * ephemeral port, so the port must be ignored for localhost / 127.0.0.1 — the
 * registered value is `http://localhost/callback` but the live one carries
 * `:51234`. Every other host must match exactly.
 */
export function isRedirectAllowed(registered: string[], requested: string): boolean {
  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  return registered.some(entry => {
    let have: URL;
    try {
      have = new URL(entry);
    } catch {
      return false;
    }
    if (have.protocol !== want.protocol || have.pathname !== want.pathname) return false;
    if (isLoopback(have) && isLoopback(want)) return true; // port deliberately ignored
    return have.host === want.host;
  });
}

/* ------------------------------------------------------------ password */

// The consent password is the master credential, so make guessing expensive.
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60_000;

export function checkPassword(candidate: string, clientKey: string): boolean {
  const now = Date.now();
  const entry = attempts.get(clientKey);
  if (entry && entry.until > now && entry.count >= MAX_ATTEMPTS) {
    throw new OAuthError('access_denied', 'Too many failed attempts. Try again later.', 429);
  }

  const expected = oauthPassword();
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const ok = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);

  if (ok) {
    attempts.delete(clientKey);
    return true;
  }
  const next = entry && entry.until > now ? entry : { count: 0, until: now + LOCKOUT_MS };
  next.count++;
  attempts.set(clientKey, next);
  logger.warn({ clientKey, count: next.count }, 'oauth: bad consent password');
  return false;
}

/* ----------------------------------------------------- dynamic registration */

export interface RegisterInput {
  client_name?: string;
  redirect_uris?: string[];
}

export async function registerClient(input: RegisterInput): Promise<Record<string, unknown>> {
  const redirect_uris = input.redirect_uris ?? [];
  if (redirect_uris.length === 0) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required');
  }
  for (const uri of redirect_uris) {
    try {
      new URL(uri);
    } catch {
      throw new OAuthError('invalid_redirect_uri', `not a valid URI: ${uri}`);
    }
  }

  const client_id = `mcp_${randomBytes(12).toString('hex')}`;
  const now = Date.now();
  await put('client', client_id, {
    kind: 'client',
    client_id,
    client_name: input.client_name ?? 'unknown',
    redirect_uris,
    created_at: iso(now),
  });

  logger.info({ client_id, client_name: input.client_name, redirect_uris }, 'oauth: client registered');
  return {
    client_id,
    client_id_issued_at: Math.floor(now / 1000),
    redirect_uris,
    client_name: input.client_name ?? 'unknown',
    // Claude registers as a public client and authenticates with PKCE alone.
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  };
}

export const getClient = (client_id: string) => get('client', client_id);

/* ------------------------------------------------------ authorization code */

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state?: string;
  resource?: string;
}

export async function issueCode(params: AuthorizeParams): Promise<string> {
  const code = newSecret();
  await put('code', hashSecret(code), {
    kind: 'code',
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    scope: params.scope,
    ...(params.resource ? { resource: params.resource } : {}),
    created_at: iso(Date.now()),
    expires_at: iso(Date.now() + CODE_TTL_MS),
  });
  return code;
}

/* --------------------------------------------------------------- tokens */

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function mintPair(client_id: string, scope: string, family: string): Promise<TokenResponse> {
  const now = Date.now();
  const access = newSecret();
  const refresh = newSecret();

  await put('access', hashSecret(access), {
    kind: 'access',
    client_id,
    scope,
    family,
    created_at: iso(now),
    expires_at: iso(now + config.OAUTH_ACCESS_TTL * 1000),
  });
  await put('refresh', hashSecret(refresh), {
    kind: 'refresh',
    client_id,
    scope,
    family,
    created_at: iso(now),
    expires_at: iso(now + config.OAUTH_REFRESH_TTL * 1000),
  });

  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: config.OAUTH_ACCESS_TTL,
    refresh_token: refresh,
    scope,
  };
}

export async function exchangeCode(args: {
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri?: string;
}): Promise<TokenResponse> {
  const key = hashSecret(args.code);
  const record = await get('code', key);
  // Single use: burn it before any other check so a replay cannot race.
  await drop('code', key);

  if (!record || isExpired(record)) throw new OAuthError('invalid_grant', 'authorization code is invalid or expired');
  if (record.client_id !== args.client_id) throw new OAuthError('invalid_grant', 'client mismatch');
  if (args.redirect_uri && record.redirect_uri !== args.redirect_uri) {
    throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
  }
  if (!verifyPkce(args.code_verifier, record.code_challenge ?? '', record.code_challenge_method ?? '')) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  }

  return mintPair(record.client_id, record.scope ?? 'mcp', randomBytes(16).toString('hex'));
}

export async function refresh(args: { refresh_token: string; client_id?: string }): Promise<TokenResponse> {
  const key = hashSecret(args.refresh_token);
  const record = await get('refresh', key);

  if (!record || isExpired(record)) {
    throw new OAuthError('invalid_grant', 'refresh token is invalid or expired');
  }
  if (args.client_id && record.client_id !== args.client_id) {
    throw new OAuthError('invalid_grant', 'client mismatch');
  }

  // Rotation is required for public clients. Burning the old token first means a
  // replayed refresh finds nothing and fails closed.
  await drop('refresh', key);
  return mintPair(record.client_id, record.scope ?? 'mcp', record.family ?? randomBytes(16).toString('hex'));
}

/** Called by the auth middleware on every request carrying a bearer token. */
export async function verifyAccessToken(token: string): Promise<OAuthRecord | null> {
  const record = await get('access', hashSecret(token));
  if (!record) return null;
  if (isExpired(record)) {
    await drop('access', hashSecret(token));
    return null;
  }
  return record;
}

export async function revokeToken(token: string): Promise<void> {
  const key = hashSecret(token);
  for (const kind of ['access', 'refresh'] as const) {
    const record = await get(kind, key);
    if (record) {
      // Revoking any token in a family kills the whole grant.
      if (record.family) await dropFamily(record.family);
      await drop(kind, key);
      return;
    }
  }
}
