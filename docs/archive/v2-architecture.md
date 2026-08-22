# Claude Memory MCP — архітектура v2 (без додаткових витрат)

Довгострокова пам'ять для Claude: MCP-сервер на Node/TS поверх OpenSearch, розміщений на власному VPS і доступний з усіх моїх пристроїв (claude.ai web/mobile/desktop, Claude Code, Claude Desktop). Один користувач. Нуль платних API: сервер не викликає жодну LLM, ембединги рахуються локально, вся LLM-робота (екстракція фактів, summary) виконується в Claude Code у межах підписки.

Замінює попередню версію. Для описів MCP-тулів див. `mcp-self-describing-spec.md` (його правила наймінгу й описів мають пріоритет).

---

## 1. Принципи

- **Сервер не думає.** Тільки зберігає, шукає, дедуплікує. Немає `ANTHROPIC_API_KEY`, немає Anthropic SDK.
- **LLM тільки через офіційний Claude Code на моїх пристроях** — хуки й slash-команди. OAuth-токен підписки ніколи не залишає Claude Code.
- **Ембединги локальні** — ONNX-модель у тому ж Node-процесі, без зовнішніх API.
- **Один сервер, всі пристрої** — Streamable HTTP за Traefik, Bearer-токен.
- **Claude ніколи не стартує з нуля** — `memory_summary` без аргументів на старті кожної розмови.

---

## 2. Стек

| Шар | Технологія |
|---|---|
| Runtime | Node 22, TypeScript, ESM |
| MCP | `@modelcontextprotocol/sdk`, транспорт Streamable HTTP (stdio лише для dev) |
| HTTP | Hono |
| Пошук | OpenSearch 2.x + плагіни `analysis-icu`, `k-NN`, `neural-search` (для hybrid query) |
| Ембединги | `@huggingface/transformers` (ONNX, CPU), модель `intfloat/multilingual-e5-base`, 768 dim. Кешується в volume; завантажується один раз з Hugging Face при першому старті |
| Валідація | zod |
| Auth | Bearer-токен, env `MCP_AUTH_TOKEN` |
| Деплой | Docker Compose, Traefik v3 labels, GitHub Actions self-hosted runner |
| Клієнтська частина | bash + `claude` CLI (хуки й команди в `~/.claude/`) |

Ресурси VPS: OpenSearch 1 GB heap + Node ~700 MB з моделлю. 2 vCPU / 4 GB достатньо.

---

## 3. Структура репозиторію

```
claude-memory/
├── docker-compose.yml
├── Dockerfile                   # Node-сервер
├── opensearch/Dockerfile        # opensearch + analysis-icu
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # bootstrap: warm embedder → init indices → http
│   ├── config.ts
│   ├── mcp/
│   │   ├── server.ts            # McpServer з instructions
│   │   ├── instructions.ts      # SERVER_INSTRUCTIONS (з self-describing-spec §3)
│   │   ├── tools/
│   │   │   ├── summary.ts
│   │   │   ├── recall.ts
│   │   │   ├── remember.ts
│   │   │   ├── update.ts
│   │   │   ├── forget.ts
│   │   │   └── detectProject.ts
│   │   ├── resources.ts
│   │   └── prompts.ts           # start_session
│   ├── search/
│   │   ├── client.ts
│   │   ├── indices.ts           # mapping + search pipeline
│   │   ├── hybrid.ts
│   │   └── dedupe.ts
│   ├── embed/
│   │   ├── embedder.ts          # interface Embedder { embed(texts): Promise<number[][]> }
│   │   └── local.ts             # transformers.js, e5 prefix "query: " / "passage: "
│   ├── core/
│   │   ├── remember.ts          # спільна логіка для MCP-тулу і REST
│   │   ├── summary.ts           # читання summary або шаблон
│   │   └── projects.ts          # реєстр проєктів, aliases
│   ├── http/
│   │   ├── app.ts               # Hono, auth middleware
│   │   └── routes/
│   │       ├── mcp.ts           # POST|GET|DELETE /mcp
│   │       ├── facts.ts         # POST /api/ingest/facts, GET /api/facts/:project
│   │       ├── summary.ts       # PUT /api/summary/:project
│   │       └── health.ts
│   └── types.ts
├── scripts/
│   ├── init-index.ts
│   ├── reindex.ts               # при зміні моделі ембедингів
│   └── backup.sh                # snapshot OpenSearch
├── claude-code/                 # копіюється в ~/.claude/ на кожному пристрої
│   ├── README.md
│   ├── settings.hooks.json      # фрагмент для ~/.claude/settings.json
│   ├── hooks/
│   │   ├── memory-extract.sh    # Stop hook
│   │   ├── memory-context.sh    # SessionStart hook (опційно)
│   │   └── lib.sh               # curl-обгортки, env
│   ├── commands/
│   │   └── memory-rebuild.md    # /memory-rebuild <project>
│   └── prompts/
│       └── extract.txt          # промпт екстракції для claude -p
└── test/
```

---

## 4. Дані (OpenSearch)

### 4.1 `memories`

```jsonc
{
  "settings": {
    "index": { "knn": true, "number_of_shards": 1, "number_of_replicas": 0 },
    "analysis": { "analyzer": { "multi_lang": {
      "type": "custom", "tokenizer": "icu_tokenizer",
      "filter": ["icu_folding", "lowercase"] }}}
  },
  "mappings": { "properties": {
    "content":       { "type": "text", "analyzer": "multi_lang" },
    "embedding":     { "type": "knn_vector", "dimension": 768,
                       "method": { "name": "hnsw", "space_type": "cosinesimil", "engine": "lucene",
                                   "parameters": { "ef_construction": 128, "m": 16 } } },
    "type":          { "type": "keyword" },   // fact|decision|preference|todo|entity|episode
    "project":       { "type": "keyword" },
    "tags":          { "type": "keyword" },
    "entities":      { "type": "keyword" },
    "importance":    { "type": "byte" },
    "status":        { "type": "keyword" },   // active|superseded|deleted
    "superseded_by": { "type": "keyword" },
    "source":        { "type": "object", "properties": {
        "kind":       { "type": "keyword" },  // tool|hook|command|manual
        "session_id": { "type": "keyword" },
        "client":     { "type": "keyword" },  // claude-code|claude-ai|claude-desktop
        "device":     { "type": "keyword" }   // hostname пристрою (з хука)
    }},
    "created_at":    { "type": "date" },
    "updated_at":    { "type": "date" },
    "last_accessed": { "type": "date" },
    "access_count":  { "type": "integer" },
    "content_hash":  { "type": "keyword" }
  }}
}
```

### 4.2 `summaries`

`project (keyword)`, `content (text, index:false)`, `facts_count`, `built_at`, `version`, `built_by (keyword: claude-code|template)`.

### 4.3 `projects`

`slug (keyword)`, `name`, `aliases (keyword[])`, `repo_names (keyword[])`, `created_at`. Створюється автоматично при першому `remember` з новим slug; aliases редагуються через `memory_update` або напряму.

Індекс `sessions` з v1 не потрібен — транскрипти залишаються на пристрої, на сервер приходять лише факти.

---

## 5. MCP-інтерфейс

Описи, `instructions`, resources і prompt — **точно за `mcp-self-describing-spec.md`**. Тут лише зміни відносно v1:

- **`memory_ingest` видалено.** Екстракція відбувається в Claude Code.
- **`memory_summary`** без аргументів → cross-project overview; з `project` → summary проєкту. Якщо в `summaries` немає запису або він старший за `SUMMARY_STALE_DAYS` — повертає шаблон з позначкою `(auto-generated; run /memory-rebuild <project> in Claude Code to refresh)`.
- **`memory_remember`** без `project` → викликає `detectProject` внутрішньо; якщо confidence < 0.6 → `project: "general"` і `project_inferred: true`.

Шаблон summary (`core/summary.ts`):
```
## {project}
{top-30 active facts by importance desc, updated_at desc, grouped by type}
## Recent decisions (7d)
{type=decision, last 7 days}
## Open todos
{type=todo}
```

---

## 6. Ембединги (`embed/local.ts`)

```ts
import { pipeline } from "@huggingface/transformers";

const extractor = await pipeline("feature-extraction", "intfloat/multilingual-e5-base",
  { cache_dir: process.env.MODEL_CACHE_DIR });

export async function embed(texts: string[], kind: "query" | "passage") {
  const prefixed = texts.map(t => `${kind}: ${t}`);       // e5 вимагає префікси
  const out = await extractor(prefixed, { pooling: "mean", normalize: true });
  return out.tolist() as number[][];
}
```

- Прогрів на старті (`index.ts`): один фіктивний виклик, щоб перший `recall` не чекав 3–5 с.
- Батчі по 16 при масовому `ingest`.
- Зміна моделі = `scripts/reindex.ts` (перерахувати всі вектори) + нове значення `EMBED_DIM` + перестворити індекс.

Альтернатива, якщо якість на українській недостатня: `intfloat/multilingual-e5-large` (1024 dim, ~2 GB RAM, повільніше). Перемикається конфігом.

---

## 7. Гібридний пошук і дедуп

Без змін від v1: OpenSearch `hybrid` query (BM25 + kNN) через search pipeline `hybrid-rrf` з нормалізацією min-max і вагами 0.4/0.6; post-rerank у Node за `importance` і `recencyDecay = exp(-ageDays/180)` (decay не застосовується до `preference`). Fallback — два запити + RRF у Node.

Дедуп при `remember`: `content_hash` exact → update; kNN top-5 у тому ж `project` з cosine ≥ `DEDUPE_THRESHOLD` (0.92) і тим же `type` → supersede. Для локальної e5-моделі поріг може потребувати калібрування — почати з 0.92, перевірити на 20–30 реальних фактах.

---

## 8. REST (для хуків і команд Claude Code)

Всі з `Authorization: Bearer <MCP_AUTH_TOKEN>`.

| Метод | Шлях | Тіло / відповідь |
|---|---|---|
| `POST` | `/api/ingest/facts` | `{ facts: [{content,type,project?,tags?,importance?}], source: {client, device, session_id} }` → `{ created, updated, merged, skipped }` |
| `GET` | `/api/facts/:project?limit=200` | активні факти, importance desc |
| `PUT` | `/api/summary/:project` | `{ content: markdown }` → `{ version }` |
| `GET` | `/api/summary/:project` | поточний summary або шаблон |
| `GET` | `/api/projects` | список з лічильниками |
| `GET` | `/health` | без auth; перевіряє OpenSearch і готовність embedder |

`POST /api/ingest/facts` проганяє кожен факт через `core/remember.ts` — та сама дедуп-логіка, що й у MCP-тулі.

---

## 9. Клієнтська частина (`claude-code/`, копіюється в `~/.claude/` на кожному пристрої)

### 9.1 `lib.sh`

```bash
MEMORY_URL="${MEMORY_URL:?}"         # https://memory.<domain>
MEMORY_TOKEN="${MEMORY_TOKEN:?}"
DEVICE="$(hostname -s)"
mem_post() { curl -sS -X POST "$MEMORY_URL$1" -H "Authorization: Bearer $MEMORY_TOKEN" \
             -H "Content-Type: application/json" --data-binary @-; }
mem_get()  { curl -sS "$MEMORY_URL$1" -H "Authorization: Bearer $MEMORY_TOKEN"; }
mem_put()  { curl -sS -X PUT "$MEMORY_URL$1" -H "Authorization: Bearer $MEMORY_TOKEN" \
             -H "Content-Type: application/json" --data-binary @-; }
```

`MEMORY_URL` і `MEMORY_TOKEN` — у `~/.claude/memory.env`, sourced з `lib.sh`.

### 9.2 `hooks/memory-extract.sh` (Stop hook)

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$HOME/.claude/hooks/lib.sh"
payload="$(cat)"                                    # hook JSON зі stdin
transcript="$(jq -r .transcript_path <<<"$payload")"
session="$(jq -r .session_id <<<"$payload")"
[ -s "$transcript" ] || exit 0

# Зібрати лише текст реплік (без tool results), щоб не роздувати промпт
text="$(jq -r 'select(.type=="user" or .type=="assistant") | .message.content
  | if type=="array" then map(select(.type=="text")|.text)|join("\n") else . end' \
  "$transcript" | tail -c 120000)"

facts="$(printf '%s\n\n---TRANSCRIPT---\n%s' "$(cat "$HOME/.claude/prompts/extract.txt")" "$text" \
  | claude -p --output-format json --model haiku 2>/dev/null \
  | jq -r '.result' | sed -e 's/^```json//' -e 's/^```//' -e 's/```$//')"

jq -n --argjson facts "$facts" --arg s "$session" --arg d "$DEVICE" \
  '{facts:$facts, source:{client:"claude-code", device:$d, session_id:$s}}' \
  | mem_post /api/ingest/facts >/dev/null || true
exit 0                                              # хук ніколи не блокує Claude Code
```

`--model haiku` — найдешевше за квотою підписки; екстракція не потребує сильної моделі.

### 9.3 `prompts/extract.txt`

```
Витягни з транскрипту ЛИШЕ довговічну інформацію: рішення, стабільні факти про системи/бізнес, преференції користувача, відкриті todo. Не включай тимчасові деталі дебагу, якщо з них не випливає урок.
Кожен елемент — одне самодостатнє речення, зрозуміле без контексту: називай проєкт/систему явно, без займенників.
Визнач project по ключових словах (getcheckout, open-chance, ideainyou, …); якщо неясно — "general".
Поверни ТІЛЬКИ JSON-масив без пояснень і без markdown:
[{"content":"...","type":"fact|decision|preference|todo|entity|episode","project":"...","tags":["..."],"importance":1-5,"confidence":0-1}]
Пропускай елементи з confidence < 0.6. Якщо нічого довговічного немає — поверни [].
```

### 9.4 `commands/memory-rebuild.md` (`/memory-rebuild <project>`)

```markdown
---
description: Rebuild long-term memory summary for a project
allowed-tools: Bash(curl:*), Bash(jq:*)
---
Project: $ARGUMENTS

1. Run: `source ~/.claude/hooks/lib.sh && mem_get /api/facts/$ARGUMENTS?limit=200`
2. From the facts, write a markdown summary ≤ 1500 tokens with sections:
   Overview / Architecture / Key decisions / Open questions / Principles.
   Prefer higher importance and newer facts. No fact ids.
3. Save it: pipe `{"content": <summary>}` to `mem_put /api/summary/$ARGUMENTS`.
4. Report the returned version number.
```

### 9.5 `hooks/memory-context.sh` (SessionStart, опційно)

Друкує в stdout `GET /api/summary/<project>`, де project визначається з `git remote get-url origin` або `basename $PWD` через `GET /api/projects` (match по `repo_names`/`aliases`). Вивід хука потрапляє в контекст Claude Code — детерміноване завантаження summary без участі моделі. Додатково друкує попередження, якщо `built_at` старший за 7 днів: `Summary is stale — run /memory-rebuild <project>`.

### 9.6 `settings.hooks.json` (злити в `~/.claude/settings.json`)

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/memory-context.sh" }] }],
    "Stop":         [{ "hooks": [{ "type": "command", "command": "~/.claude/hooks/memory-extract.sh" }] }]
  }
}
```

MCP-сервер у user scope, один раз на пристрій:
```
claude mcp add --scope user --transport http memory https://memory.<domain>/mcp \
  --header "Authorization: Bearer <token>"
```

---

## 10. Підключення інших клієнтів

- **claude.ai (web/mobile/desktop):** Settings → Connectors → Add custom connector → `https://memory.<domain>/mcp`, Bearer token. Увімкнути в кожному Project. Поведінка забезпечується `instructions` + описами тулів; хуків немає, тому факти пишуться через `memory_remember` під час розмови.
- **Claude Desktop / Cowork:** той самий конектор.
- **Claude Code на інших пристроях:** скопіювати `claude-code/` в `~/.claude/`, створити `memory.env`, виконати `claude mcp add` вище.

---

## 11. Деплой

### docker-compose.yml

```yaml
services:
  opensearch:
    build: ./opensearch
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
networks:
  internal: {}
  traefik: { external: true }
```

Dockerfile для `memory` — multi-stage; модель **не** запікати в образ, вона завантажується в `model-cache` при першому старті (потрібен вихідний доступ до huggingface.co один раз).

### .env.example

```dotenv
PORT=3000
MCP_AUTH_TOKEN=                      # openssl rand -hex 32
OPENSEARCH_URL=http://opensearch:9200

EMBED_MODEL=intfloat/multilingual-e5-base
EMBED_DIM=768
MODEL_CACHE_DIR=/models

DEDUPE_THRESHOLD=0.92
SUMMARY_STALE_DAYS=7
RECALL_DEFAULT_K=8
```

Немає `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`.

---

## 12. Порядок реалізації

1. Scaffold, Dockerfiles, compose, `config.ts`, `/health`.
2. `embed/local.ts` з прогрівом; unit-тест на розмірність і стабільність вектора.
3. `search/indices.ts` (mapping, search pipeline), `scripts/init-index.ts`.
4. `core/remember.ts` + `search/dedupe.ts` + `search/hybrid.ts`; тести на фікстурах (UA/EN факти).
5. MCP-тули й `instructions` за self-describing-spec; перевірка в MCP Inspector по stdio.
6. Streamable HTTP + auth; `claude mcp add`, перший реальний `memory_summary`.
7. REST `/api/*`.
8. `claude-code/`: `lib.sh`, `memory-extract.sh`, `extract.txt`, `memory-rebuild.md`, `memory-context.sh`; перевірити на одній сесії.
9. Resources, prompt `start_session`, `backup.sh`, CI.

---

## 13. Нефункціональні вимоги

- Хуки ніколи не фейлять сесію: всі `exit 0`, таймаут `claude -p` 120 с.
- Логи pino JSON; контент фактів не логувати на info.
- Ліміти: `content` ≤ 2000 символів, `k` ≤ 30, `/api/ingest/facts` ≤ 500 елементів за раз.
- Бекап: `backup.sh` щоночі — snapshot OpenSearch у volume; раз на тиждень копія на Hetzner Object Storage.
- Тести: vitest; інтеграційні через testcontainers.

---

## 14. Зафіксовані рішення

- Платні API — жодних. Якщо якість локальних ембедингів виявиться недостатньою — спершу `e5-large`, лише потім обговорювати Voyage.
- Один користувач; поле `owner` у mapping не додається. Якщо з'явиться — міграція через `reindex.ts`.
- Стороннього доступу до сервера немає; `MCP_AUTH_TOKEN` — єдиний секрет, ротація = замінити в `.env`, `memory.env` на пристроях і в конекторах claude.ai.