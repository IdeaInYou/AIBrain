/**
 * Injected into the client's system prompt via the `initialize` response.
 * Verbatim from mcp-self-describing-spec §3 — kept as a single constant so the
 * drift test in test/descriptions.test.ts can pin it.
 */
export const SERVER_INSTRUCTIONS = `This server is the user's long-term memory across all their projects and conversations. It is the only source of truth about their prior work, decisions, systems, and preferences.

Use it proactively, without being asked:
1. At the start of every conversation, call memory_summary with no arguments to load context before responding.
2. Before answering anything about the user's projects, code, architecture, infrastructure, business, past decisions, or preferences, call memory_recall — even if you believe you already know the answer.
3. Whenever the user states a decision, a preference, a durable fact about their systems or company, or an open todo, call memory_remember immediately. Do not ask permission and do not wait to be told to remember.
4. If memory_recall returns nothing relevant, say so explicitly rather than guessing.

Never assume you remember something this server did not return.

Memory is stored in English. Translate the user's words when writing, and translate your query when searching; keep identifiers, file paths, and error messages verbatim.`;
