# Claude Memory MCP — архітектура для реалізації

Довгострокова пам'ять для Claude: MCP-сервер на Node/TS поверх OpenSearch (гібридний BM25 + kNN пошук), з фоновим екстрактором фактів і дедуплікацією. Підключається до claude.ai (кастомний конектор), Claude Code, Claude Desktop і до власних API-застосунків.

---

## 1. Цілі та принципи

- **Claude ніколи не стартує з нуля**: на початку сесії отримує summary проєкту + ключові факти; решту дістає пошуком.
- **Пам'ять не залежить від ініціативи моделі**: є фоновий екстрактор, який сам витягує факти/рішення з сесій.
- **Одна істина**: суперечливі факти не накопичуються — старі позначаються `superseded_by`.
- **Переносимість**: один MCP-сервер для всіх клієнтів Claude.
- **Self-hosted**: Docker Compose на Hetzner за Traefik v3.

---

## 2. Стек

| Шар | Технологія |
|---|---|
| Runtime | Node 22, TypeScript, ESM |
| MCP | `@modelcontextprotocol/sdk` (server), транспорт **Streamable HTTP** + stdio для локальної розробки |
| HTTP | Hono (або Fastify) — обгортка для MCP endpoint + REST для екстрактора |
| Пошук | OpenSearch 2.x (`@opensearch-project/opensearch`), плагін `neural-search` + `k-NN` |
| Ембединги | **Варіант A (простіше):** зовнішній API — Voyage `voyage-3` (1024 dim) або OpenAI `text-embedding-3-small` (1536). **Варіант B:** ML-модель усередині OpenSearch (`huggingface/sentence-transformers/all-MiniLM-L6-v2`, 384 dim) через neural-search pipeline. Починаємо з A; інтерфейс `Embedder` має дозволяти заміну. |
| LLM для екстракції | Anthropic API, `claude-haiku-4-5` |
| Валідація | zod |
| Auth | Bearer-токен (env `MCP_AUTH_TOKEN`), перевірка в middleware |
| Деплой | Docker Compose, Traefik labels, GitHub Actions (self-hosted runner) |

---

## 3. Структура репозиторію

```
claude-memory/
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # bootstrap: http server + mcp + cron
│   ├── config.ts                # env → typed config (zod)
│   ├── mcp/
│   │   ├── server.ts            # McpServer, реєстрація tools/resources/prompts
│   │   ├── tools/
│   │   │   ├── remember.ts
│   │   │   ├── recall.ts
│   │   │   ├── update.ts
│   │   │   ├── forget.ts
│   │   │   ├── summary.ts
│   │   │   └── ingest.ts
│   │   ├── resources.ts         # memory://... resources
│   │   └── prompts.ts           # prompt "start_session"
│   ├── search/
│   │   ├── client.ts            # OpenSearch client
│   │   ├── index.ts             # створення індексів, mapping, міграції
│   │   ├── hybrid.ts            # гібридний запит (BM25 + kNN + RRF/normalization)
│   │   └── dedupe.ts            # пошук дублікатів, supersede-логіка
│   ├── embed/
│   │   ├── embedder.ts          # інтерфейс Embedder
│   │   ├── voyage.ts
│   │   └── openai.ts
│   ├── extract/
│   │   ├── extractor.ts         # LLM-екстракція фактів із транскрипту
│   │   ├── prompts.ts
│   │   └── schema.ts            # zod-схема результату екстракції
│   ├── summary/
│   │   └── builder.ts           # перебудова summary по проєкту
│   ├── http/
│   │   ├── app.ts               # Hono app, auth middleware
│   │   └── routes/
│   │       ├── mcp.ts           # POST/GET/DELETE /mcp
│   │       ├── ingest.ts        # POST /api/ingest (транскрипти)
│   │       └── health.ts
│   ├── jobs/
│   │   ├── scheduler.ts         # cron (node-cron)
│   │   └── rebuildSummaries.ts
│   └── types.ts
├── scripts/
│   ├── init-index.ts
│   └── reindex.ts
└── test/
```

---

## 4. Модель даних (OpenSearch)

### 4.1 Індекс `memories`

```jsonc
{
  "settings": {
    "index": { "knn": true, "number_of_shards": 1, "number_of_replicas": 0 },
    "analysis": {
      "analyzer": {
        "multi_lang": {                     // UA/EN/DE/ES/FR вміст
          "type": "custom",
          "tokenizer": "icu_tokenizer",
          "filter": ["icu_folding", "lowercase"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "content":        { "type": "text", "analyzer": "multi_lang" },
      "embedding":      { "type": "knn_vector", "dimension": 1024,
                          "method": { "name": "hnsw", "space_type": "cosinesimil", "engine": "lucene",
                                      "parameters": { "ef_construction": 128, "m": 16 } } },
      "type":           { "type": "keyword" },   // fact | decision | preference | episode | todo | entity
      "project":        { "type": "keyword" },   // getcheckout | open-chance | ideainyou | general
      "tags":           { "type": "keyword" },
      "entities":       { "type": "keyword" },   // нормалізовані сутності: shopify, adyen, nova-poshta
      "importance":     { "type": "byte" },      // 1..5
      "confidence":     { "type": "float" },     // 0..1
      "status":         { "type": "keyword" },   // active | superseded | deleted
      "superseded_by":  { "type": "keyword" },
      "source":         { "type": "object", "properties": {
          "kind":       { "type": "keyword" },   // tool | extractor | manual | import
          "session_id": { "type": "keyword" },
          "client":     { "type": "keyword" }    // claude-code | claude-ai | api
      }},
      "created_at":     { "type": "date" },
      "updated_at":     { "type": "date" },
      "last_accessed":  { "type": "date" },
      "access_count":   { "type": "integer" },
      "content_hash":   { "type": "keyword" }    // sha256(normalize(content)) для exact dedupe
    }
  }
}
```

Встановити плагін `analysis-icu` в образ OpenSearch (Dockerfile: `bin/opensearch-plugin install analysis-icu`).

### 4.2 Індекс `summaries`

```jsonc
{ "mappings": { "properties": {
  "project":     { "type": "keyword" },
  "content":     { "type": "text" },      // markdown, ~1–2k токенів
  "facts_count": { "type": "integer" },
  "built_at":    { "type": "date" },
  "version":     { "type": "integer" }
}}}
```

### 4.3 Індекс `sessions` (сирі транскрипти для екстракції й аудиту)

```jsonc
{ "mappings": { "properties": {
  "session_id": { "type": "keyword" },
  "client":     { "type": "keyword" },
  "project":    { "type": "keyword" },
  "transcript": { "type": "text", "index": false },
  "extracted":  { "type": "boolean" },
  "created_at": { "type": "date" }
}}}
```

---

## 5. MCP-інтерфейс

### 5.1 Tools

**`memory_remember`**
```ts
input: {
  content: string;                 // 1–2 речення, самодостатній факт
  type: "fact"|"decision"|"preference"|"episode"|"todo"|"entity";
  project?: string;                // default "general"
  tags?: string[];
  entities?: string[];
  importance?: 1|2|3|4|5;          // default 3
}
output: { id: string; action: "created"|"updated"|"merged"; superseded?: string[] }
```
Логіка: normalize → hash → exact match? → update. Інакше embed → kNN top-5 в тому ж `project` → якщо cosine ≥ 0.92 і той самий `type` → supersede старий (status=superseded, superseded_by=newId), повернути `merged`. Інакше `created`.

**`memory_recall`**
```ts
input: {
  query: string;
  project?: string | string[];
  type?: string[];
  since?: string;                  // ISO date або "30d"
  k?: number;                      // default 8, max 30
  include_superseded?: boolean;    // default false
}
output: { results: Array<{ id, content, type, project, tags, importance, created_at, score }> }
```
Після відповіді — оновити `last_accessed`, `access_count++` (bulk update, fire-and-forget).

**`memory_update`**
```ts
input: { id: string; content?: string; tags?: string[]; importance?: number; type?: string }
```
Створює нову версію (новий doc), старий → superseded. Не мутує content in-place, щоб зберігати історію.

**`memory_forget`**
```ts
input: { id?: string; filter?: { project?, type?, tags?, before? }; reason?: string }
```
Soft delete (`status=deleted`). Hard delete — окремим скриптом, не через MCP.

**`memory_summary`**
```ts
input: { project: string; rebuild?: boolean }
output: { content: string; built_at: string; facts_count: number }
```
Віддає кешований summary; `rebuild=true` запускає `summary/builder.ts` синхронно.

**`memory_ingest`**
```ts
input: { transcript: string; project?: string; session_id?: string; client?: string }
output: { session_id: string; extracted: number; merged: number }
```
Зберігає в `sessions`, запускає екстрактор, повертає статистику. Це головний канал «пам'ять без ініціативи моделі».

### 5.2 Resources

- `memory://projects` — список проєктів з кількістю активних фактів
- `memory://projects/{project}/summary` — markdown summary
- `memory://projects/{project}/recent?days=7` — нові факти/рішення
- `memory://preferences` — всі `type=preference` (стиль спілкування, мова, формат)

### 5.3 Prompts

**`start_session`** (args: `project`) — повертає готовий контекст:
```
# Memory context for {project}
{summary}

## Preferences
{preferences as bullets}

## Recent (7d)
{recent decisions/todos}

Instructions: Before answering questions about prior work, call memory_recall.
When the user states a decision, preference, or durable fact — call memory_remember.
```

---

## 6. Гібридний пошук (`search/hybrid.ts`)

OpenSearch підтримує `hybrid` query з search pipeline для нормалізації. Один запит:

```ts
// 1. Створити pipeline один раз (init-index):
PUT /_search/pipeline/hybrid-rrf
{
  "phase_results_processors": [{
    "normalization-processor": {
      "normalization": { "technique": "min_max" },
      "combination": { "technique": "arithmetic_mean",
                       "parameters": { "weights": [0.4, 0.6] } }   // BM25 : kNN
    }
  }]
}

// 2. Запит:
POST /memories/_search?search_pipeline=hybrid-rrf
{
  "size": k,
  "query": {
    "hybrid": {
      "queries": [
        { "bool": {
            "must": [{ "match": { "content": { "query": q, "operator": "or" } } }],
            "filter": FILTERS } },
        { "bool": {
            "must": [{ "knn": { "embedding": { "vector": qVec, "k": k * 3 } } }],
            "filter": FILTERS } }
      ]
    }
  }
}
```

`FILTERS` = `status:active` + project/type/since. Після отримання результатів — **rerank на стороні Node**:

```
final = hybridScore * importanceBoost * recencyDecay
importanceBoost = 1 + (importance - 3) * 0.1
recencyDecay    = exp(-ageDays / 180)   // половина ваги ~4 міс; для type=preference decay не застосовувати
```

Якщо версія OpenSearch < 2.10 або `hybrid` недоступний — fallback: два окремих запити + RRF у Node (`score = Σ 1/(60 + rank)`).

---

## 7. Екстрактор (`extract/`)

Вхід: транскрипт сесії (або шматок). Викликається з `memory_ingest`, з REST `/api/ingest`, або з hook Claude Code (`Stop` hook → POST транскрипту).

Промпт до Haiku — повернути тільки JSON:

```ts
const ExtractionSchema = z.object({
  items: z.array(z.object({
    content: z.string().max(400),      // самодостатнє, без займенників "це/воно"
    type: z.enum(["fact","decision","preference","episode","todo","entity"]),
    project: z.string(),
    tags: z.array(z.string()).max(6),
    entities: z.array(z.string()).max(6),
    importance: z.number().int().min(1).max(5),
    confidence: z.number().min(0).max(1)
  }))
});
```

Правила в промпті:
- Витягувати лише **довговічне**: рішення, факти про системи, преференції, відкриті todo. Не витягувати тимчасові деталі дебагу, якщо з них не випливає урок.
- Кожен item — одне твердження, зрозуміле без контексту ("GetCheckout використовує Adyen для EUR, Stripe для UAH", а не "вирішили так").
- `confidence < 0.6` → пропустити.
- Проєкт визначати по ключових словах; якщо неясно — `general`.

Кожен item → `memory_remember` (з dedupe). Транскрипти довші 30k токенів — чанкувати по ~10k з overlap 500.

---

## 8. Summary builder (`summary/builder.ts`)

Тригери: cron щоночі; `memory_remember` з `importance ≥ 4`; `memory_summary(rebuild=true)`.

Алгоритм:
1. Вибрати всі `active` факти проєкту, відсортувати: importance desc, updated_at desc, ліміт 150.
2. Haiku/Sonnet промпт: «Зшити в структурований markdown ≤ 1500 токенів: Огляд / Архітектура / Ключові рішення / Відкриті питання / Принципи». Посилатися на id фактів не треба.
3. Записати в `summaries` з `version++`.

---

## 9. HTTP / Auth / Деплой

### Endpoints
- `POST|GET|DELETE /mcp` — Streamable HTTP MCP transport (stateful sessions з `Mcp-Session-Id`)
- `POST /api/ingest` — `{ transcript, project?, session_id?, client? }`
- `GET /health` — перевіряє OpenSearch cluster health

Усі, крім `/health`, вимагають `Authorization: Bearer <MCP_AUTH_TOKEN>`.

### docker-compose.yml (скелет)

```yaml
services:
  opensearch:
    build: ./opensearch          # базовий образ + analysis-icu
    environment:
      - discovery.type=single-node
      - DISABLE_SECURITY_PLUGIN=true      # тільки у внутрішній мережі
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
    volumes: [os-data:/usr/share/opensearch/data]
    networks: [internal]

  memory-mcp:
    build: .
    env_file: .env
    depends_on: [opensearch]
    networks: [internal, traefik]
    labels:
      - traefik.enable=true
      - traefik.http.routers.memory.rule=Host(`memory.<your-domain>`)
      - traefik.http.routers.memory.entrypoints=websecure
      - traefik.http.routers.memory.tls.certresolver=le
      - traefik.http.services.memory.loadbalancer.server.port=3000

volumes: { os-data: {} }
networks:
  internal: {}
  traefik: { external: true }
```

OpenSearch **не** виставляти назовні. Порт 3000 стандартний за Traefik — Cloudflare orange-cloud ок.

### .env.example
```
PORT=3000
MCP_AUTH_TOKEN=
OPENSEARCH_URL=http://opensearch:9200
EMBED_PROVIDER=voyage            # voyage | openai
VOYAGE_API_KEY=
EMBED_DIM=1024
ANTHROPIC_API_KEY=
EXTRACT_MODEL=claude-haiku-4-5
SUMMARY_MODEL=claude-sonnet-4-6
DEDUPE_THRESHOLD=0.92
```

---

## 10. Підключення клієнтів

- **claude.ai** → Settings → Connectors → Add custom connector → URL `https://memory.<domain>/mcp`, Bearer token.
- **Claude Code** → `.mcp.json` у репо або `claude mcp add --transport http memory https://memory.<domain>/mcp --header "Authorization: Bearer ..."`. Додати у `CLAUDE.md`: «На старті викликай prompt `start_session` з project=<назва>». Hook `Stop` → скрипт, що POST-ить транскрипт у `/api/ingest`.
- **Власний API-застосунок** → передавати сервер у `mcp_servers` Messages API, або викликати tools напряму через MCP-клієнт.

---

## 11. Порядок реалізації (для Claude Code)

1. Scaffold: package.json, tsconfig, config.ts, Dockerfile, docker-compose, `scripts/init-index.ts` (індекси + search pipeline). Перевірити `/health`.
2. `embed/` з інтерфейсом + Voyage-реалізацією.
3. `search/hybrid.ts` + `search/dedupe.ts` з unit-тестами на фікстурах.
4. MCP tools `remember`, `recall`, `update`, `forget` через stdio; перевірити в MCP Inspector.
5. Streamable HTTP transport + auth middleware; підключити до Claude Code.
6. `extract/` + `memory_ingest` + `/api/ingest`.
7. `summary/builder.ts`, resources, prompt `start_session`, cron.
8. Stop-hook для Claude Code, CI деплой.

---

## 12. Нефункціональні вимоги

- Логування: pino, JSON, без контенту фактів на рівні info (лише ids).
- Retry з backoff на embed/LLM-виклики; ingest — ідемпотентний по `session_id`.
- Ліміти: `content` ≤ 2000 символів; `recall.k` ≤ 30; тіло ingest ≤ 2 MB.
- Бекап: snapshot OpenSearch щоночі у volume/S3-сумісне сховище (Hetzner Object Storage).
- Тести: vitest; інтеграційні — testcontainers з OpenSearch.

---

## 13. Відкриті рішення (зафіксувати перед стартом)

- Ембединги: Voyage (краща якість, зовнішній API) vs локальна модель в OpenSearch (без зовнішніх залежностей, 384 dim, гірше для UA). Рекомендація — Voyage.
- Мультитенантність: поки один користувач; поле `owner` закласти в mapping зараз, щоб не реіндексувати.
- Чи потрібен stdio-режим у проді — ні, лише для dev.
