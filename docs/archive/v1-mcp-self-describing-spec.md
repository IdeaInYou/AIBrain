# Memory MCP — Self-Describing Server Spec

Goal: Claude uses this server automatically in every client (claude.ai, Claude Code, Claude Desktop, API apps) **with zero user-side instructions**. All behavioral guidance lives inside the MCP server itself: the `instructions` field, tool descriptions, parameter descriptions, and tool/resource naming. Same mechanism Context7 relies on.

This document is additive to `claude-memory-mcp-architecture.md`. Where they overlap, this document wins for naming and descriptions.

---

## 1. Why this works

Every MCP client sends Claude:

1. Server `instructions` (from the `initialize` response) — many clients inject this into the system prompt.
2. Each tool's `name`, `description`, and JSON schema (including per-field `description`).
3. Resource and prompt listings.

Claude decides to call a tool by reading these. There is no trigger engine. Therefore:

- Descriptions must be written as **triggers** ("ALWAYS call before X"), not features ("allows searching").
- The first tool Claude should call must take **no arguments**, so there is no reason to hesitate.
- Server `instructions` repeats the same rules for clients that honor it.

---

## 2. Naming

| Item | Value | Reason |
|---|---|---|
| Server name | `memory` | Tool names render as `memory_*`; the prefix self-documents |
| Server version | semver | — |
| Tool prefix | `memory_` | Consistent grouping in tool lists |

Do not name it `claude-memory`, `memory-mcp`, `brain`, etc.

---

## 3. Server `instructions`

Set in `McpServer` constructor options. Exact text:

```text
This server is the user's long-term memory across all their projects and conversations. It is the only source of truth about their prior work, decisions, systems, and preferences.

Use it proactively, without being asked:
1. At the start of every conversation, call memory_summary with no arguments to load context before responding.
2. Before answering anything about the user's projects, code, architecture, infrastructure, business, past decisions, or preferences, call memory_recall — even if you believe you already know the answer.
3. Whenever the user states a decision, a preference, a durable fact about their systems or company, or an open todo, call memory_remember immediately. Do not ask permission and do not wait to be told to remember.
4. If memory_recall returns nothing relevant, say so explicitly rather than guessing.

Never assume you remember something this server did not return.
```

Implementation:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

export const server = new McpServer(
  { name: "memory", version: "1.0.0" },
  { instructions: SERVER_INSTRUCTIONS }
);
```

Keep the text in `src/mcp/instructions.ts` as a single exported constant so it can be unit-tested for drift (see §8).

---

## 4. Tool descriptions

Three tools carry the imperative weight. The rest are descriptive.

### 4.1 `memory_summary` — the entry point

- **No required arguments.** This is non-negotiable; an argument-free tool is what gets called first.
- Must be fast (< 300 ms, served from cache) and short (≤ 800 tokens).

```ts
server.tool(
  "memory_summary",
  "ALWAYS call this first in a new conversation, before your first response to the user. " +
  "Returns the user's active projects, key preferences, and recent decisions. " +
  "Takes no arguments. Without this call you do not know what the user is working on. " +
  "Pass a project name only if the user already named one.",
  {
    project: z.string().optional()
      .describe("Optional. A project name if the user already mentioned one. Omit otherwise."),
  },
  handleSummary
);
```

Response shape (markdown string):

```markdown
## Projects
- getcheckout — Shopify external checkout (Stripe/Adyen/LiqPay, Nova Poshta). 142 facts.
- open-chance — multilingual networking platform on Nuxt/Cloudflare. 87 facts.
- ideainyou — Estonian OÜ, legal/company matters. 23 facts.

## Preferences
- Responds in Ukrainian when asked in Ukrainian; concise, actionable.
- Works from real code/errors, not generic examples.

## Recent decisions (7d)
- [getcheckout] Klarna rejected for UA market; Stripe-routed preferred.
- [open-chance] hreflang reciprocity identified as key indexing factor.

Call memory_recall for details on any of these.
```

The last line is intentional — it nudges the follow-up call.

### 4.2 `memory_recall` — retrieval

```ts
server.tool(
  "memory_recall",
  "Search the user's long-term memory. REQUIRED before answering any question about " +
  "their projects, codebase, architecture, infrastructure, business, past decisions, or " +
  "preferences — even if you believe you already know the answer. " +
  "Searches across all projects by default; the project filter is optional.",
  {
    query: z.string()
      .describe("What you want to know, phrased like the user's question. Include specific names (services, libraries, features)."),
    project: z.string().optional()
      .describe("Optional project filter. Omit if unsure — each result includes its project."),
    type: z.array(z.enum(["fact","decision","preference","todo","entity","episode"])).optional()
      .describe("Optional. Restrict to memory types."),
    since: z.string().optional()
      .describe("Optional. ISO date or relative like '30d'. Use for 'recent' questions."),
    k: z.number().int().min(1).max(30).optional()
      .describe("Number of results. Default 8."),
  },
  handleRecall
);
```

Response: list of `{ id, project, type, content, created_at, score }`. Always include `id` so `memory_update`/`memory_forget` can reference it.

### 4.3 `memory_remember` — write

```ts
server.tool(
  "memory_remember",
  "Store a durable fact in the user's long-term memory. Call IMMEDIATELY when the user " +
  "states a decision, a preference, a fact about their systems or company, or an open todo. " +
  "Do not ask permission and do not wait to be told to remember. " +
  "One call per fact. Omit project if unsure; it will be inferred.",
  {
    content: z.string().max(2000)
      .describe("One self-contained sentence, understandable without the conversation. Name the project/system explicitly, no pronouns like 'it' or 'this'."),
    type: z.enum(["fact","decision","preference","todo","entity","episode"])
      .describe("decision = a choice made; preference = how the user likes to work; fact = stable truth about a system/business; todo = open item; entity = a person/tool/service; episode = notable event"),
    project: z.string().optional()
      .describe("Omit if unsure; the server infers it from content."),
    tags: z.array(z.string()).max(6).optional(),
    importance: z.number().int().min(1).max(5).optional()
      .describe("1 = trivia, 3 = default, 5 = architectural/business-critical"),
  },
  handleRemember
);
```

Response: `{ id, action: "created" | "updated" | "merged", project, superseded?: string[] }`. Keep it short; Claude should not narrate it to the user.

### 4.4 Supporting tools (plain descriptions)

```ts
server.tool("memory_update",
  "Correct or refine an existing memory by id. Use when the user says something previously stored is wrong or has changed.",
  { id: z.string(), content: z.string().optional(), type: ..., tags: ..., importance: ... },
  handleUpdate);

server.tool("memory_forget",
  "Remove a memory by id, or by filter. Use only when the user explicitly asks to forget something.",
  { id: z.string().optional(), filter: z.object({...}).optional(), reason: z.string().optional() },
  handleForget);

server.tool("memory_detect_project",
  "Resolve which of the user's projects a piece of text refers to. Use when you need a project name and the user did not state one.",
  { hint: z.string() },
  handleDetect);

server.tool("memory_ingest",
  "Extract and store durable facts from a conversation transcript. Use at the end of a long session, or when the user asks to save the conversation.",
  { transcript: z.string(), project: z.string().optional(), session_id: z.string().optional() },
  handleIngest);
```

---

## 5. Resources

Resources are listed to Claude too; names and descriptions matter.

| URI | Description |
|---|---|
| `memory://summary` | "Cross-project overview. Same content as memory_summary." |
| `memory://projects` | "List of the user's projects with fact counts." |
| `memory://projects/{project}/summary` | "Current summary of one project." |
| `memory://preferences` | "How the user prefers to work and communicate." |

Register `memory://summary` as a **static** resource (not a template) so clients that support auto-attaching resources can surface it.

---

## 6. Prompts

Expose one prompt; clients like Claude Code render prompts as slash commands.

```ts
server.prompt(
  "start_session",
  "Load long-term memory context for this conversation. Optional project name.",
  { project: z.string().optional() },
  async ({ project }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: await buildStartSessionText(project) },
    }],
  })
);
```

`buildStartSessionText` = `memory_summary` output + the four rules from §3, verbatim.

---

## 7. Wording rules (for maintaining descriptions)

Do:
- Lead with the trigger: "ALWAYS call…", "REQUIRED before…", "Call IMMEDIATELY when…".
- Pre-empt the skip reason: "even if you believe you already know the answer", "do not wait to be told".
- State what happens without the call: "Without this you do not know…".
- Tell Claude what to do with optional args: "Omit if unsure".
- Keep each description ≤ 60 words; the first sentence carries the decision.

Don't:
- "Allows you to", "can be used to", "helps with" — passive, ignored.
- Describe implementation (OpenSearch, embeddings, hybrid search). Claude doesn't need it and it dilutes the trigger.
- Put the same rule in more than two places. Instructions + tool description is enough.

---

## 8. Tests

`test/descriptions.test.ts`:

- Snapshot test on `listTools()` output — any change to descriptions is a deliberate diff.
- Assert `memory_summary` has no required properties.
- Assert `SERVER_INSTRUCTIONS` contains the strings `memory_summary`, `memory_recall`, `memory_remember`.
- Assert every tool description ≤ 400 chars.

`test/behavior.test.ts` (optional, uses Anthropic API):

- Given the tool list + a first user message "how did we decide on payments for GetCheckout?", assert the first tool call is `memory_summary` or `memory_recall`. Run 5×, expect ≥ 4/5.
- Given "from now on always answer in Ukrainian", assert a `memory_remember` call with `type: "preference"`. Run 5×, expect ≥ 4/5.

---

## 9. Client-side fallbacks (optional, not required)

Where the runtime is controlled, add deterministic injection on top — this is belt-and-braces, not a requirement of this spec:

- **Claude Code:** `SessionStart` hook prints `memory://summary`; `UserPromptSubmit` hook prints `memory_recall` results; `Stop` hook posts transcript to `memory_ingest`. Lives in `~/.claude/settings.json` (user scope, applies to all repos).
- **Own API app:** call summary + recall server-side, inject into the system prompt; expose only `memory_remember` as a tool.

claude.ai and Claude Desktop rely on §3–§6 only.

---

## 10. Checklist

- [ ] Server name is `memory`
- [ ] `instructions` set with exact §3 text
- [ ] `memory_summary` takes no required args and returns ≤ 800 tokens from cache
- [ ] `memory_summary` output ends with the nudge line
- [ ] `memory_recall` / `memory_remember` descriptions match §4 verbatim
- [ ] All optional args say "Omit if unsure" where applicable
- [ ] `memory://summary` registered as static resource
- [ ] `start_session` prompt registered
- [ ] Snapshot test on tool list passing