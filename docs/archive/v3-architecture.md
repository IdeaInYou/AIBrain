# Claude Memory MCP — архітектура v3

Мета: щоб Claude через місяць пам'ятав, **що ми робили і нащо**. Не повна база знань про проєкти, а журнал сесій + ключові рішення. Сервер на власному VPS, доступ з усіх моїх пристроїв, один користувач, нуль платних API. Уся пам'ять зберігається й шукається **англійською**; я спілкуюся будь-якою мовою.

Замінює v1 і v2. Описи MCP-тулів — за `mcp-self-describing-spec.md` з правками в §5.

---

## 1. Принципи

- **Episode — основна одиниця.** Одна сесія роботи → одна нотатка: що робили, чому, результат, що відклали. Пишеться хуком автоматично, не залежить від того, чи «згадала» модель.
- **Facts — другорядні.** 0–5 рішень/преференцій на сесію, якщо були. Без спроби витягти все.
- **English-only storage.** Хук і тули перекладають на вході. Сервер не знає про інші мови.
- **Recency > importance.** Те, що було місяць тому, має бути зверху; пів року тому — нижче.
- **Сервер не думає.** Зберігає і шукає. LLM тільки в Claude Code на моїх пристроях, у межах підписки.
- **Summary = хронологія.** Шаблон з останніх episodes, без LLM-перебудови.

---

## 2. Стек

| Шар | Технологія |
|---|---|
| Runtime | Node 22, TypeScript, ESM |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP |
| HTTP | Hono |
| Пошук | OpenSearch 2.x + `k-NN`, `neural-search` (hybrid query). Аналізатор `english`. |
| Ембединги | `@huggingface/transformers` (ONNX, CPU), `BAAI/bge-base-en-v1.5`, 768 dim |
| Auth | Bearer, `MCP_AUTH_TOKEN` |
| Деплой | Docker Compose, Traefik v3 |
| Клієнт | bash + `claude` CLI у `~/.claude/` |

VPS: 2 vCPU / 4 GB. OpenSearch 1 GB heap, Node ~500 MB.

---

## 3. Структура репозиторію

```
claude-memory/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── src/
│   ├── index.ts                  # warm embedder → init indices → http
│   ├── config.ts
│   ├── mcp/
│   │   ├── server.ts
│   │   ├── instructions.ts
│   │   ├── tools/
│   │   │   ├── summary.ts
│   │   │   ├── recall.ts
│   │   │   ├── remember.ts
│   │   │   ├── update.ts
│   │   │   └── forget.ts
│   │   ├── resources.ts
│   │   └── prompts.ts
│   ├── search/
│   │   ├── client.ts
│   │   ├── indices.ts
│   │   ├── hybrid.ts
│   │   └── dedupe.ts
│   ├── embed/
│   │   ├── embedder.ts
│   │   └── local.ts
│   ├── core/
│   │   ├── remember.ts           # спільна логіка MCP + REST
│   │   ├── summary.ts            # шаблонна хронологія
│   │   └── projects.ts
│   ├── http/
│   │   ├── app.ts
│   │   └── routes/{mcp,ingest,facts,projects,health}.ts
│   └── types.ts
├── scripts/{init-index,reindex}.ts, backup.sh
├── claude-code/                  # → ~/.claude/ на кожному пристрої
│   ├── README.md
│   ├── memory.env.example
│   ├── settings.hooks.json
│   ├── hooks/{lib.sh, memory-context.sh, memory-extract.sh}
│   ├── commands/memory-log.md
│   └── prompts/extract.txt
└── test/
```

---

## 4. Дані

### 4.1 Індекс `memories`

```jsonc
{
  "settings": { "index": { "knn": true, "number_of_shards": 1, "number_of_replicas": 0 } },
  "mappings": { "properties": {
    "content":       { "type": "text", "analyzer": "english" },
    "embedding":     { "type": "knn_vector", "dimension": 768,
                       "method": { "name": "hnsw", "space_type": "cosinesimil", "engine": "lucene",
                                   "parameters": { "ef_construction": 128, "m": 16 } } },
    "type":          { "type": "keyword" },   // episode | decision | preference | todo | fact
    "project":       { "type": "keyword" },
    "tags":          { "type": "keyword" },
    "importance":    { "type": "byte" },      // 1..5, default 3
    "status":        { "type": "keyword" },   // active | superseded | done | deleted
    "superseded_by": { "type": "keyword" },
    "episode":       { "type": "object", "properties": {   // лише для type=episode
        "did":       { "type": "text", "analyzer": "english" },
        "why":       { "type": "text", "analyzer": "english" },
        "outcome":   { "type": "text", "analyzer": "english" },
        "deferred":  { "type": "text", "analyzer": "english" },
        "files":     { "type": "keyword" }                  // touched paths, для Claude Code
    }},
    "source":        { "type": "object", "properties": {
        "kind":       { "type": "keyword" },  // hook | tool | command
        "client":     { "type": "keyword" },  // claude-code | claude-ai | claude-desktop
        "device":     { "type": "keyword" },
        "session_id": { "type": "keyword" }
    }},
    "occurred_at":   { "type": "date" },      // коли це відбулося (дата сесії)
    "created_at":    { "type": "date" },
    "content_hash":  { "type": "keyword" }
  }}
}
```

Для `episode` поле `content` = склеєний текст `did + why + outcome + deferred` (для пошуку); структуровані поля — для відображення.

### 4.2 Індекс `projects`

`slug`, `name`, `repo_names[]`, `aliases[]`, `last_activity`. Створюється при першому записі.

Індекси `summaries` і `sessions` не потрібні.

---

## 5. MCP-інтерфейс

`instructions`, resources, prompt — за `mcp-self-describing-spec.md`. Правки:

### `memory_summary` (без аргументів; опційно `project`, `days`)

Повертає шаблонну хронологію, не LLM-текст:

```markdown
## Last 30 days
- 2026-08-20 · getcheckout · Fixed country-detection cookie precedence; explicit body value now overrides stale cookie. Deferred: Adyen multi-currency.
- 2026-08-18 · open-chance · Confirmed GSC indexing works after cold start; hreflang reciprocity is the next lever.
- 2026-08-14 · getcheckout · Rejected Klarna for UA market; Stripe-routed flow chosen.
…

## Open todos
- [getcheckout] Decide Adyen vs Shopify Payments on the OÜ entity.

## Preferences
- Answer in the language the user writes in; keep replies concise and actionable.

Call memory_recall for details on any item.
```

Один рядок на episode: `occurred_at · project · did (перше речення) + "Deferred: …"` якщо є. Ліміт 15 рядків, `days` default 30.

### `memory_recall`

Без змін за описом. Додати в description: *"Query must be in English; translate the user's question if needed."*

Rerank у Node після hybrid:
```
episode:    score * exp(-ageDays / 90)
decision:   score * exp(-ageDays / 180) * (1 + (importance-3)*0.1)
todo:       score * 1.2            (якщо status=active)
preference: score                  (без decay)
```

### `memory_remember`

Додати в description: *"content must be in English; translate if the user wrote in another language. Keep the user's original technical terms, identifiers, and error messages verbatim."*

Для `type=episode` через цей тул — дозволено, але основний шлях — хук. Дедуп не застосовується до `episode`.

### `memory_update` / `memory_forget`

Без змін. Додати `memory_update` можливість `status: "done"` для todo.

---

## 6. Ембединги (`embed/local.ts`)

```ts
const extractor = await pipeline("feature-extraction", "BAAI/bge-base-en-v1.5",
  { cache_dir: process.env.MODEL_CACHE_DIR });

export async function embed(texts: string[], kind: "query" | "passage") {
  // bge: для запитів рекомендований префікс, для документів — ні
  const input = kind === "query"
    ? texts.map(t => `Represent this sentence for searching relevant passages: ${t}`)
    : texts;
  const out = await extractor(input, { pooling: "cls", normalize: true });
  return out.tolist();
}
```

Прогрів на старті. Модель у volume `model-cache`, завантажується з huggingface.co один раз.

---

## 7. Пошук і дедуп

Hybrid query (BM25 0.4 + kNN 0.6, min-max) через search pipeline, фільтри `status:active` + project/type/since. Fallback — RRF у Node.

Дедуп тільки для `decision | preference | fact | todo`: `content_hash` exact → update; kNN top-5 у тому ж `project`+`type` з cosine ≥ `DEDUPE_THRESHOLD` (старт 0.90 для bge) → supersede. `episode` завжди `created`.

---

## 8. REST (для хуків і команд)

Bearer на всіх, крім `/health`.

| Метод | Шлях | Призначення |
|---|---|---|
| `POST` | `/api/ingest` | `{ episode?: {...}, facts?: [...], project, source }` → `{ episode_id?, facts: {created, updated, merged} }` |
| `GET` | `/api/summary?project=&days=` | те саме, що `memory_summary` (для SessionStart-хука) |
| `GET` | `/api/projects` | список, `last_activity` |
| `GET` | `/health` | OpenSearch + embedder ready |

`POST /api/ingest` приймає текст **тільки англійською**; сервер не перекладає.

---

## 9. Клієнт (`claude-code/` → `~/.claude/`)

### 9.1 `memory.env.example`
```
MEMORY_URL=https://memory.<domain>
MEMORY_TOKEN=
```

### 9.2 `hooks/lib.sh`
```bash
source "$HOME/.claude/memory.env"
DEVICE="$(hostname -s)"
mem_get()  { curl -sS --max-time 10 "$MEMORY_URL$1" -H "Authorization: Bearer $MEMORY_TOKEN"; }
mem_post() { curl -sS --max-time 30 -X POST "$MEMORY_URL$1" -H "Authorization: Bearer $MEMORY_TOKEN" \
             -H "Content-Type: application/json" --data-binary @-; }
detect_project() {
  local hint; hint="$(git remote get-url origin 2>/dev/null || basename "$PWD")"
  mem_get "/api/projects" | jq -r --arg h "$hint" \
    '.projects[] | select(.repo_names[]?, .aliases[]?, .slug | inside($h)) | .slug' | head -1
}
```

### 9.3 `hooks/memory-context.sh` (SessionStart)
```bash
#!/usr/bin/env bash
set -uo pipefail; source "$HOME/.claude/hooks/lib.sh"
p="$(detect_project)"
mem_get "/api/summary?project=${p:-}&days=30" 2>/dev/null \
  || echo "(memory server unreachable — proceed without long-term context)"
exit 0
```
Вивід потрапляє в контекст Claude Code. Детерміновано, без участі моделі.

### 9.4 `hooks/memory-extract.sh` (Stop)
```bash
#!/usr/bin/env bash
set -uo pipefail; source "$HOME/.claude/hooks/lib.sh"
payload="$(cat)"
transcript="$(jq -r .transcript_path <<<"$payload")"
session="$(jq -r .session_id <<<"$payload")"
[ -s "$transcript" ] || exit 0
p="$(detect_project)"; p="${p:-general}"

text="$(jq -r 'select(.type=="user" or .type=="assistant") | .message.content
  | if type=="array" then map(select(.type=="text")|.text)|join("\n") else . end' \
  "$transcript" | tail -c 120000)"
[ "${#text}" -lt 400 ] && exit 0          # надто коротка сесія — нема що журналити

result="$(printf '%s\n\n---TRANSCRIPT---\n%s' "$(cat "$HOME/.claude/prompts/extract.txt")" "$text" \
  | timeout 120 claude -p --output-format json --model haiku 2>/dev/null \
  | jq -r '.result' | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')"
[ -z "$result" ] && exit 0

jq -n --argjson r "$result" --arg p "$p" --arg s "$session" --arg d "$DEVICE" \
  '$r + {project:$p, source:{kind:"hook", client:"claude-code", device:$d, session_id:$s}}' \
  | mem_post /api/ingest >/dev/null 2>&1 || true
exit 0
```

### 9.5 `prompts/extract.txt`
```
You are summarizing a work session between a developer and Claude Code for a long-term memory log.
Write EVERYTHING in English, regardless of the transcript language. Keep identifiers, file paths, service names, and error messages verbatim.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "episode": {
    "did": "1–2 sentences: what was actually done or investigated",
    "why": "1 sentence: the reason or trigger",
    "outcome": "1 sentence: result — fixed / partially / blocked / decided",
    "deferred": "1 sentence or empty string: what was explicitly postponed",
    "files": ["paths touched, max 10"]
  },
  "facts": [
    { "content": "one self-contained English sentence naming the project/system explicitly",
      "type": "decision|preference|todo|fact",
      "tags": ["..."], "importance": 1-5 }
  ]
}
"facts" holds only durable items: decisions made, user preferences stated, open todos, stable facts about systems. Max 5. Use [] if none. Skip debugging noise.
```

### 9.6 `commands/memory-log.md` (`/memory-log <text>`)
Ручний запис episode або рішення з Claude Code, коли хук не спрацює (наприклад, сесія перервана):
```markdown
---
description: Write a note to long-term memory (episode or decision)
allowed-tools: Bash(curl:*), Bash(jq:*)
---
Turn this into English and POST it to memory:
$ARGUMENTS

Decide whether it is an episode (what/why/outcome) or a fact (decision/preference/todo).
Build the JSON per ~/.claude/prompts/extract.txt shape and run:
`source ~/.claude/hooks/lib.sh && echo '<json>' | mem_post /api/ingest`
Report the returned id.
```

### 9.7 `settings.hooks.json`
```json
{ "hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/memory-context.sh" }] }],
  "Stop":         [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/memory-extract.sh" }] }]
}}
```
MCP у user scope:
```
claude mcp add --scope user --transport http memory https://memory.<domain>/mcp \
  --header "Authorization: Bearer <token>"
```

---

## 10. Інші клієнти

- **claude.ai (web/mobile/desktop), Claude Desktop:** custom connector → `/mcp`. Пам'ять пишеться через `memory_remember` у розмові (тул сам перекладає на англійську). На старті Claude бачить хронологію через `memory_summary`.
- Якщо в claude.ai була важлива сесія — сказати «запиши в пам'ять, що ми зробили і нащо»; Claude викличе `memory_remember` з `type=episode`.

---

## 11. Деплой

```yaml
services:
  opensearch:
    image: opensearchproject/opensearch:2
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
    volumes: [os-data:/usr/share/opensearch/data]
    networks: [internal]

  memory:
    build: .
    env_file: .env
    volumes: [model-cache:/models]
    depends_on: [opensearch]
    networks: [internal, traefik]
    labels:
      - traefik.enable=true
      - traefik.http.routers.memory.rule=Host(`memory.<domain>`)
      - traefik.http.routers.memory.entrypoints=websecure
      - traefik.http.routers.memory.tls.certresolver=le
      - traefik.http.services.memory.loadbalancer.server.port=3000

volumes: { os-data: {}, model-cache: {} }
networks: { internal: {}, traefik: { external: true } }
```

Плагін `analysis-icu` більше не потрібен — стандартний образ.

`.env.example`:
```dotenv
PORT=3000
MCP_AUTH_TOKEN=
OPENSEARCH_URL=http://opensearch:9200
EMBED_MODEL=BAAI/bge-base-en-v1.5
EMBED_DIM=768
MODEL_CACHE_DIR=/models
DEDUPE_THRESHOLD=0.90
SUMMARY_DAYS=30
SUMMARY_MAX_EPISODES=15
RECALL_DEFAULT_K=8
```

---

## 12. Порядок реалізації

1. Scaffold, compose, `config.ts`, `/health`.
2. `embed/local.ts` + прогрів; тест на розмірність.
3. `search/indices.ts`, search pipeline, `init-index.ts`.
4. `core/remember.ts` (episode без дедупу, facts з дедупом), `hybrid.ts`, rerank; тести на фікстурах.
5. `core/summary.ts` — шаблонна хронологія; тест на формат.
6. MCP-тули за spec + правки §5; перевірка в MCP Inspector.
7. Streamable HTTP + auth; `claude mcp add`; перший `memory_summary`.
8. REST `/api/ingest`, `/api/summary`, `/api/projects`.
9. `claude-code/`: хуки, `extract.txt`, `memory-log.md`; перевірити на одній реальній сесії — episode має з'явитися на сервері англійською.
10. `backup.sh`, CI.

---

## 13. Нефункціональні

- Хуки завжди `exit 0`; `curl --max-time`, `timeout 120` на `claude -p`.
- Сесії < 400 символів тексту не журналяться.
- Логи pino, без контенту на info.
- Бекап snapshot щоночі; тижнева копія на Object Storage.

---

## 14. Зафіксовано

- English-only storage. Переклад — обов'язок хука (`extract.txt`) і тулу (`memory_remember` description).
- Episode не дедуплікується; кожна сесія — окремий запис.
- Summary — шаблон, без LLM; `/memory-rebuild` з v2 прибрано.
- Без платних API. Якщо bge-base не вистачить — `bge-large-en-v1.5` (1024 dim).