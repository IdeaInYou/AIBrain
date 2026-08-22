import type { Hono } from 'hono';
import { OAUTH, SERVER_NAME, config } from '../../config.js';
import { logger } from '../../logger.js';
import {
  OAuthError,
  checkPassword,
  exchangeCode,
  getClient,
  isRedirectAllowed,
  issueCode,
  refresh,
  registerClient,
  revokeToken,
} from '../../oauth/service.js';

/** RFC 9728 — tells Claude where the authorization server lives. */
function protectedResourceMetadata() {
  return {
    resource: OAUTH.resource,
    authorization_servers: [OAUTH.issuer],
    scopes_supported: [...OAUTH.scopes],
    bearer_methods_supported: ['header'],
  };
}

/** RFC 8414 — authorization server metadata. */
function authorizationServerMetadata() {
  return {
    issuer: OAUTH.issuer,
    authorization_endpoint: OAUTH.authorizationEndpoint,
    token_endpoint: OAUTH.tokenEndpoint,
    registration_endpoint: OAUTH.registrationEndpoint,
    revocation_endpoint: `${OAUTH.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Claude verifies S256 support here before starting the flow.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...OAUTH.scopes],
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function consentPage(params: Record<string, string>, error?: string): string {
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('\n      ');
  const clientName = esc(params.client_name || 'An MCP client');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to ${SERVER_NAME}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --muted:#666; --line:#ddd; --accent:#2b6cb0; --err:#c53030; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#16181c; --fg:#e8e8e8; --muted:#9aa0a6; --line:#333; --accent:#63b3ed; --err:#fc8181; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; }
  .card { width:100%; max-width:380px; border:1px solid var(--line); border-radius:12px; padding:28px; }
  h1 { font-size:18px; margin:0 0 6px; }
  p { color:var(--muted); margin:0 0 20px; font-size:14px; }
  label { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
  input[type=password] { width:100%; padding:10px 12px; font-size:15px; border:1px solid var(--line);
                         border-radius:8px; background:transparent; color:var(--fg); }
  button { width:100%; margin-top:16px; padding:11px; font-size:15px; font-weight:600; border:0;
           border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
  .err { color:var(--err); font-size:13px; margin:12px 0 0; }
  .scope { font-size:12px; color:var(--muted); margin-top:18px; padding-top:14px; border-top:1px solid var(--line); }
</style></head>
<body>
  <form class="card" method="POST" action="/oauth/authorize">
    <h1>Connect to your memory</h1>
    <p><strong>${clientName}</strong> is requesting access to your long-term memory.</p>
    ${hidden}
    <label for="password">Authorization password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <button type="submit">Approve</button>
    <p class="scope">Grants read and write access to every project in your memory.</p>
  </form>
</body></html>`;
}

const CARRIED = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource', 'client_name'];

/** Mounted before the auth middleware — all of these must be reachable unauthenticated. */
export function mountOAuth(app: Hono): void {
  app.get('/.well-known/oauth-protected-resource', c => c.json(protectedResourceMetadata()));
  // Claude probes the path-suffixed form first when the MCP server has a path.
  app.get('/.well-known/oauth-protected-resource/*', c => c.json(protectedResourceMetadata()));
  app.get('/.well-known/oauth-authorization-server', c => c.json(authorizationServerMetadata()));
  app.get('/.well-known/oauth-authorization-server/*', c => c.json(authorizationServerMetadata()));
  // Some clients look for the OIDC document instead.
  app.get('/.well-known/openid-configuration', c => c.json(authorizationServerMetadata()));

  // RFC 7591 dynamic client registration — JSON body, not form-encoded.
  app.post('/oauth/register', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const result = await registerClient({
        ...(typeof body.client_name === 'string' ? { client_name: body.client_name } : {}),
        ...(Array.isArray(body.redirect_uris) ? { redirect_uris: body.redirect_uris as string[] } : {}),
      });
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof OAuthError) return c.json({ error: err.code, error_description: err.message }, 400);
      throw err;
    }
  });

  app.get('/oauth/authorize', async c => {
    const q = c.req.query();
    const problem = await validateAuthorize(q);
    if (problem) return c.text(problem, 400);

    const client = await getClient(q.client_id!);
    const params: Record<string, string> = { client_name: client?.client_name ?? 'An MCP client' };
    for (const k of CARRIED) if (q[k]) params[k] = q[k]!;
    return c.html(consentPage(params));
  });

  app.post('/oauth/authorize', async c => {
    const form = await c.req.parseBody();
    const q: Record<string, string> = {};
    for (const k of CARRIED) if (typeof form[k] === 'string') q[k] = form[k];

    const problem = await validateAuthorize(q);
    if (problem) return c.text(problem, 400);

    const password = typeof form.password === 'string' ? form.password : '';
    try {
      if (!checkPassword(password, q.client_id ?? 'unknown')) {
        return c.html(consentPage(q, 'Incorrect password.'), 401);
      }
    } catch (err) {
      if (err instanceof OAuthError) return c.html(consentPage(q, err.message), err.status as 429);
      throw err;
    }

    const code = await issueCode({
      client_id: q.client_id!,
      redirect_uri: q.redirect_uri!,
      code_challenge: q.code_challenge!,
      code_challenge_method: q.code_challenge_method!,
      scope: q.scope || 'mcp',
      ...(q.resource ? { resource: q.resource } : {}),
    });

    const target = new URL(q.redirect_uri!);
    target.searchParams.set('code', code);
    if (q.state) target.searchParams.set('state', q.state);
    logger.info({ client_id: q.client_id }, 'oauth: authorization granted');
    return c.redirect(target.toString(), 302);
  });

  // RFC 6749 §4.1.3 / §6 — form-urlencoded, never JSON.
  app.post('/oauth/token', async c => {
    try {
      const form = await c.req.parseBody();
      const s = (k: string) => (typeof form[k] === 'string' ? form[k] : undefined);
      const grant = s('grant_type');

      if (grant === 'authorization_code') {
        const code = s('code');
        const verifier = s('code_verifier');
        const clientId = s('client_id');
        if (!code || !verifier || !clientId) {
          throw new OAuthError('invalid_request', 'code, code_verifier and client_id are required');
        }
        const tokens = await exchangeCode({
          code,
          code_verifier: verifier,
          client_id: clientId,
          ...(s('redirect_uri') ? { redirect_uri: s('redirect_uri')! } : {}),
        });
        return c.json(tokens, 200, { 'cache-control': 'no-store' });
      }

      if (grant === 'refresh_token') {
        const rt = s('refresh_token');
        if (!rt) throw new OAuthError('invalid_request', 'refresh_token is required');
        const tokens = await refresh({ refresh_token: rt, ...(s('client_id') ? { client_id: s('client_id')! } : {}) });
        return c.json(tokens, 200, { 'cache-control': 'no-store' });
      }

      throw new OAuthError('unsupported_grant_type', `unsupported grant_type: ${grant ?? '(none)'}`);
    } catch (err) {
      if (err instanceof OAuthError) {
        // Claude keys off the RFC 6749 code; a custom one breaks its refresh logic.
        return c.json({ error: err.code, error_description: err.message }, err.status as 400);
      }
      throw err;
    }
  });

  app.post('/oauth/revoke', async c => {
    const form = await c.req.parseBody();
    if (typeof form.token === 'string') await revokeToken(form.token);
    return c.body(null, 200); // RFC 7009: always 200, even for unknown tokens
  });
}

/** Returns an error string when the request must not reach the consent screen. */
async function validateAuthorize(q: Record<string, string | undefined>): Promise<string | null> {
  if (!q.client_id) return 'client_id is required';
  if (!q.redirect_uri) return 'redirect_uri is required';
  if (q.response_type && q.response_type !== 'code') return 'only response_type=code is supported';
  if (!q.code_challenge) return 'PKCE is required: code_challenge is missing';
  if ((q.code_challenge_method ?? 'plain') !== 'S256') return 'code_challenge_method must be S256';

  const client = await getClient(q.client_id);
  if (!client) return 'unknown client_id';

  // Never redirect to an unregistered URI — that is the open-redirect hole.
  if (!isRedirectAllowed(client.redirect_uris ?? [], q.redirect_uri)) {
    logger.warn({ client_id: q.client_id, redirect_uri: q.redirect_uri }, 'oauth: redirect_uri rejected');
    return 'redirect_uri does not match any registered URI for this client';
  }
  return null;
}

export function oauthConfigured(): boolean {
  return Boolean(config.PUBLIC_URL);
}
