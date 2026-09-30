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
4. When the user asks about something you do not recognize, call memory_recall before answering. Never say you have no information without searching first.
5. If memory_recall returns nothing relevant, say so explicitly rather than guessing.
6. Do not search for generic programming questions, or when the answer is already in this conversation or in the loaded summary. Use at most 3 memory_recall calls per turn; if they find nothing, stop and say so.
7. If memory_remember returns "similar", check them: when one says the same thing or is now outdated, call memory_update on it with the corrected text instead of keeping both.

What to store: only what still holds outside this conversation, written so it is understandable without it. A suggestion is not a decision until the user adopts it. Skip one-off instructions ("this time"), debugging noise, and anything you only repeated from memory.

Never assume you remember something this server did not return.

Memory is stored in English. Translate the user's words when writing, and translate your query when searching; keep identifiers, file paths, and error messages verbatim.

Recall results may include refs (repo-relative file paths) and a note resource; read them when the user needs detail beyond the one-line summary.`;
