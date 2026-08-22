import { afterEach, describe, expect, it, vi } from 'vitest';
import { os, osExists } from '../src/search/client.js';

const realTransport = os.transport;

afterEach(() => {
  (os as unknown as { transport: unknown }).transport = realTransport;
});

function stubTransport(response: { body: unknown; statusCode?: number }) {
  (os as unknown as { transport: unknown }).transport = {
    request: vi.fn().mockResolvedValue(response),
  };
}

describe('osExists', () => {
  // Regression: opensearch-js does NOT throw for HEAD + 404 (Transport.js —
  // "ignore the statusCode … if the request method is HEAD and the statusCode
  // is 404"), it resolves with the body cast to a boolean. A try/catch around
  // the request reports every index as existing, so ensureIndices() creates
  // nothing and the server crash-loops on a missing index.
  it('returns false when the client reports HEAD 404 without throwing', async () => {
    stubTransport({ body: false, statusCode: 404 });
    expect(await osExists('/memories')).toBe(false);
  });

  it('returns true for an index that exists', async () => {
    stubTransport({ body: true, statusCode: 200 });
    expect(await osExists('/memories')).toBe(true);
  });

  it('falls back to the status code when the body is not a boolean', async () => {
    stubTransport({ body: '', statusCode: 200 });
    expect(await osExists('/memories')).toBe(true);

    stubTransport({ body: '', statusCode: 404 });
    expect(await osExists('/memories')).toBe(false);
  });

  it('treats a missing status code as not existing rather than existing', async () => {
    stubTransport({ body: undefined });
    expect(await osExists('/memories')).toBe(false);
  });
});
