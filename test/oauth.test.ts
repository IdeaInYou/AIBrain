import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isRedirectAllowed, verifyPkce } from '../src/oauth/service.js';

const challengeFor = (verifier: string) => createHash('sha256').update(verifier, 'utf8').digest('base64url');

describe('verifyPkce', () => {
  it('accepts a matching S256 verifier', () => {
    const verifier = randomBytes(32).toString('base64url');
    expect(verifyPkce(verifier, challengeFor(verifier), 'S256')).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    const verifier = randomBytes(32).toString('base64url');
    expect(verifyPkce('not-it', challengeFor(verifier), 'S256')).toBe(false);
  });

  // "plain" lets anyone who intercepts the authorization request replay it.
  it('refuses the plain method even when the values match', () => {
    expect(verifyPkce('abc', 'abc', 'plain')).toBe(false);
  });

  it('refuses an empty challenge', () => {
    expect(verifyPkce('abc', '', 'S256')).toBe(false);
  });
});

describe('isRedirectAllowed', () => {
  const claude = ['https://claude.ai/api/mcp/auth_callback'];

  it('accepts the exact registered URI', () => {
    expect(isRedirectAllowed(claude, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it('rejects a different host — the open-redirect case', () => {
    expect(isRedirectAllowed(claude, 'https://evil.example.com/api/mcp/auth_callback')).toBe(false);
  });

  it('rejects a different path on the right host', () => {
    expect(isRedirectAllowed(claude, 'https://claude.ai/api/mcp/somewhere_else')).toBe(false);
  });

  it('rejects a downgrade to http', () => {
    expect(isRedirectAllowed(claude, 'http://claude.ai/api/mcp/auth_callback')).toBe(false);
  });

  it('rejects a host that merely contains the registered one', () => {
    expect(isRedirectAllowed(claude, 'https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false);
  });

  // RFC 8252: Claude Code binds an ephemeral loopback port that cannot be
  // registered ahead of time, so the port must be ignored for loopback only.
  const loopback = ['http://localhost/callback', 'http://127.0.0.1/callback'];

  it('ignores the port for localhost', () => {
    expect(isRedirectAllowed(loopback, 'http://localhost:51234/callback')).toBe(true);
  });

  it('ignores the port for 127.0.0.1', () => {
    expect(isRedirectAllowed(loopback, 'http://127.0.0.1:8123/callback')).toBe(true);
  });

  it('does not extend port-insensitivity to non-loopback hosts', () => {
    expect(isRedirectAllowed(['https://example.com/cb'], 'https://example.com:8443/cb')).toBe(false);
  });

  it('rejects a loopback request against a non-loopback registration', () => {
    expect(isRedirectAllowed(claude, 'http://localhost:51234/api/mcp/auth_callback')).toBe(false);
  });

  it('rejects malformed input rather than throwing', () => {
    expect(isRedirectAllowed(claude, 'not a url')).toBe(false);
    expect(isRedirectAllowed(['also not a url'], 'https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });

  it('rejects everything when nothing is registered', () => {
    expect(isRedirectAllowed([], 'https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });
});
