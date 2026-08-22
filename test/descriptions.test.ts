import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { SERVER_INSTRUCTIONS } from '../src/mcp/instructions.js';

interface ListedTool {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
}

/** Reaches through McpServer to the registered tools without standing up a transport. */
async function listTools(): Promise<ListedTool[]> {
  const server = createMcpServer();
  const result = (await server.server
    // @ts-expect-error -- _requestHandlers is internal but stable, and beats a transport round trip.
    ._requestHandlers.get('tools/list')({ method: 'tools/list', params: {} }, {
    signal: new AbortController().signal,
  })) as { tools: ListedTool[] };
  return result.tools;
}

describe('server instructions', () => {
  it('names the three tools that carry the imperative weight', () => {
    for (const tool of ['memory_summary', 'memory_recall', 'memory_remember']) {
      expect(SERVER_INSTRUCTIONS).toContain(tool);
    }
  });

  it('tells the model not to substitute its own recollection', () => {
    expect(SERVER_INSTRUCTIONS).toContain('Never assume you remember something this server did not return.');
  });

  it('tells the model to search before claiming ignorance', () => {
    expect(SERVER_INSTRUCTIONS).toContain('Never say you have no information without searching first.');
  });

  it('states the English-only storage rule', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/stored in English/i);
  });
});

describe('tool list', () => {
  it('exposes exactly the v3 tool set — memory_ingest is gone', async () => {
    const names = (await listTools()).map(t => t.name).sort();
    expect(names).toEqual([
      'memory_forget',
      'memory_recall',
      'memory_remember',
      'memory_summary',
      'memory_update',
    ]);
  });

  it('memory_summary has no required arguments', async () => {
    const summary = (await listTools()).find(t => t.name === 'memory_summary');
    expect(summary).toBeDefined();
    expect(summary!.inputSchema.required ?? []).toEqual([]);
  });

  it('leads each description with a trigger, not a feature', async () => {
    const byName = new Map((await listTools()).map(t => [t.name, t.description ?? '']));
    expect(byName.get('memory_summary')).toMatch(/^ALWAYS call this first/);
    expect(byName.get('memory_recall')).toMatch(/REQUIRED before/);
    expect(byName.get('memory_remember')).toMatch(/Call IMMEDIATELY when/);
  });

  it('pre-empts the reasons a model would skip the call', async () => {
    const byName = new Map((await listTools()).map(t => [t.name, t.description ?? '']));
    expect(byName.get('memory_recall')).toContain('even if you believe you already know the answer');
    expect(byName.get('memory_remember')).toContain('Do not ask permission');
  });

  // The most common failure is answering "I don't know" about a term the user
  // has already stored, so the trigger has to cover unfamiliar words explicitly.
  it('memory_recall covers unfamiliar terms, not just known project topics', async () => {
    const desc = (await listTools()).find(t => t.name === 'memory_recall')?.description ?? '';
    expect(desc).toMatch(/unfamiliar/);
    expect(desc).toMatch(/don't recognize/);
  });

  it('tells the model to write and search in English', async () => {
    const byName = new Map((await listTools()).map(t => [t.name, t.description ?? '']));
    expect(byName.get('memory_recall')).toMatch(/in English/);
    expect(byName.get('memory_remember')).toMatch(/in English/);
  });

  it('keeps every description under 400 characters', async () => {
    const tooLong = (await listTools())
      .map(t => ({ name: t.name, length: (t.description ?? '').length }))
      .filter(t => t.length > 400);
    expect(tooLong).toEqual([]);
  });

  it('snapshots the descriptions so any wording change is a deliberate diff', async () => {
    const shape = (await listTools()).map(t => ({ name: t.name, description: t.description }));
    expect(shape).toMatchSnapshot();
  });
});
