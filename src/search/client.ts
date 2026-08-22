import { Client } from '@opensearch-project/opensearch';
import { config } from '../config.js';

export const os = new Client({
  node: config.OPENSEARCH_URL,
  requestTimeout: 15_000,
  maxRetries: 2,
});

interface RawTransport {
  request(params: {
    method: string;
    path: string;
    body?: unknown;
    querystring?: Record<string, string | number | boolean>;
  }): Promise<{ body: unknown; statusCode?: number }>;
}

/**
 * Escape hatch for endpoints the typed client does not model — the `hybrid`
 * query clause (neural-search plugin) and the search pipeline API.
 */
export async function osRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  querystring?: Record<string, string | number | boolean>,
): Promise<T> {
  const transport = os.transport as unknown as RawTransport;
  const res = await transport.request({
    method,
    path,
    ...(body !== undefined ? { body } : {}),
    ...(querystring ? { querystring } : {}),
  });
  return res.body as T;
}

/**
 * HEAD-based existence check.
 *
 * Do NOT write this as `try { osRequest('HEAD', …) } catch (404)`. The client
 * deliberately does not throw for HEAD + 404 — Transport.js: "ignore the
 * statusCode … if the request method is HEAD and the statusCode is 404" — and
 * casts the body to a boolean instead. A try/catch therefore reports every
 * index as already existing, so nothing is ever created.
 */
export async function osExists(path: string): Promise<boolean> {
  const transport = os.transport as unknown as RawTransport;
  const res = await transport.request({ method: 'HEAD', path });
  if (typeof res.body === 'boolean') return res.body;
  return (res.statusCode ?? 500) < 400;
}

export function statusOf(err: unknown): number | undefined {
  const s = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === 'number' ? s : undefined;
}

export async function clusterHealth(): Promise<{ status: string; cluster_name: string }> {
  return osRequest('GET', '/_cluster/health');
}
