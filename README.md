# Claude Memory MCP

Довгострокова пам'ять для Claude: MCP-сервер на Node/TS поверх OpenSearch, на власному VPS, доступний з усіх пристроїв (claude.ai web/mobile/desktop, Claude Code, Claude Desktop). Один користувач, нуль платних API.

Мета — щоб Claude через місяць пам'ятав, **що ми робили і нащо**. Це не повна база знань про проєкти, а журнал сесій + ключові рішення.

---

## 1. Принципи

- **Episode — основна одиниця.** Одна сесія роботи → одна нотатка: що робили, чому, результат, що відклали. Пишеться Stop-хуком автоматично, не залежить від того, чи «згадала» модель.
- **Facts — другорядні.** 0–5 рішень/преференцій на сесію, якщо були. Без спроби витягти все.
- **English-only storage.** Хук і описи тулів перекладають на вході. Сервер не знає про інші мови.
- **Recency > importance.** Те, що було місяць тому, — зверху; пів року тому — нижче.
- **Сервер не думає.** Зберігає і шукає. Жодного виклику LLM: немає `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `OPENAI_API_KEY`. Ембединги — локальна ONNX-модель у тому ж процесі.
- **LLM тільки через офіційний Claude Code** на моїх пристроях — хуки й slash-команди, у межах підписки. OAuth-токен ніколи не залишає Claude Code.
- **Summary = шаблонна хронологія**, без LLM-перебудови.
- **Claude ніколи не стартує з нуля** — `memory_summary` без аргументів на початку кожної розмови.

---

## 2. Стек

| Шар | Технологія |
|---|---|
| Runtime | Node 22, TypeScript, ESM |
| MCP | `@modelcontextprotocol/server` v2, транспорт Streamable HTTP (stdio лише для dev) |
| HTTP | Hono + `@hono/node-server` |
| Пошук | OpenSearch 2.x, `k-NN` + `neural-search` (hybrid query), аналізатор `english` |
| Ембединги | `@huggingface/transformers` (ONNX, CPU), `BAAI/bge-base-en-v1.5`, 768 dim |
| Валідація | zod v4 |
| Логи | pino |
| Auth | Bearer, `MCP_AUTH_TOKEN` |
| Деплой | Docker Compose, Traefik v3 |
| Клієнт | bash + `claude` CLI у `~/.claude/` |

VPS: 2 vCPU / 4 GB. OpenSearch 1 GB heap, Node ~500 MB з моделлю.

---

## 3. Швидкий старт

### Сервер

```bash
cp .env.example .env
# MCP_AUTH_TOKEN=$(openssl rand -hex 32)
docker compose up -d          # перший старт тягне ~450 MB моделі у volume model-cache
curl -s localhost:3000/health | jq
```

Локальна розробка без Docker:

```bash
npm install
npm run dev                   # tsx watch, HTTP
npm run dev:stdio             # stdio — для MCP Inspector
npm run init-index            # створити індекси та search pipeline вручну
npm test
```

Індекси створюються автоматично на старті; `init-index` потрібен лише для окремого прогону.

### Клієнт

Див. [claude-code/README.md](claude-code/README.md). Коротко:

```bash
cp -r claude-code/{hooks,prompts,commands} ~/.claude/
cp claude-code/memory.env.example ~/.claude/memory.env   # заповнити MEMORY_URL, MEMORY_TOKEN
chmod +x ~/.claude/hooks/*.sh
# змерджити claude-code/settings.hooks.json у ~/.claude/settings.json

claude mcp add --scope user --transport http memory https://memory.<domain>/mcp \
  --header "Authorization: Bearer <token>"
```

### claude.ai / Claude Desktop

Settings → Connectors → Add custom connector → `https://memory.<domain>/mcp`, Bearer token. Хуків там немає, тому факти пишуться через `memory_remember` під час розмови — описи тулів самі це вимагають.

---

## 4. Структура репозиторію

```
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── src/
│   ├── index.ts                 # warm embedder → init indices → http
│   ├── config.ts                # env → typed config (zod), INDEX, LIMITS
│   ├── logger.ts                # pino; на stdio пише в stderr
│   ├── types.ts
│   ├── mcp/
│   │   ├── server.ts            # McpServer + instructions
│   │   ├── instructions.ts      # SERVER_INSTRUCTIONS (§6.2)
│   │   ├── tools/{summary,recall,remember,update,forget}.ts
│   │   ├── resources.ts
│   │   └── prompts.ts           # start_session
│   ├── search/
│   │   ├── client.ts            # OpenSearch client + osRequest
│   │   ├── indices.ts           # mappings + search pipeline
│   │   ├── hybrid.ts            # hybrid query, RRF fallback, knn, listMemories
│   │   ├── dedupe.ts            # normalize, hash, cosine, near-duplicate
│   │   └── rerank.ts            # per-type decay
│   ├── embed/
│   │   ├── embedder.ts          # інтерфейс, singleton, warm
│   │   └── local.ts             # transformers.js, bge
│   ├── core/
│   │   ├── remember.ts          # єдиний write-path: MCP + REST
│   │   ├── memory.ts            # recall, update, forget, вибірки
│   │   ├── summary.ts           # шаблонна хронологія
│   │   ├── ingest.ts            # episode + facts за раз
│   │   └── projects.ts          # реєстр проєктів, aliases, repo_names
│   └── http/
│       ├── app.ts               # Hono, Bearer middleware
│       └── routes/{mcp,ingest,summary,projects,health}.ts
├── scripts/
│   ├── init-index.ts
│   ├── reindex.ts               # при зміні моделі ембедингів
│   └── backup.sh                # snapshot OpenSearch
├── claude-code/                 # → ~/.claude/ на кожному пристрої
│   ├── README.md
│   ├── memory.env.example
│   ├── settings.hooks.json
│   ├── hooks/{lib.sh,memory-context.sh,memory-extract.sh}
│   ├── commands/memory-log.md
│   └── prompts/extract.txt
└── test/
```

---

## 5. Дані

### 5.1 Індекс `memories`

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
        "did": {...}, "why": {...}, "outcome": {...}, "deferred": {...},
        "files": { "type": "keyword" } }},
    "source":        { "type": "object", "properties": {
        "kind":       { "type": "keyword" },  // hook | tool | command
        "client":     { "type": "keyword" },  // claude-code | claude-ai | claude-desktop
        "device":     { "type": "keyword" },
        "session_id": { "type": "keyword" } }},
    "occurred_at":   { "type": "date" },      // коли це відбулося (дата сесії) — керує recency
    "created_at":    { "type": "date" },
    "content_hash":  { "type": "keyword" }
  }}
}
```

Для `episode` поле `content` = склеєний `did + why + outcome + deferred` (для пошуку); структуровані поля — для відображення.

### 5.2 Індекс `projects`

`slug`, `name`, `repo_names[]`, `aliases[]`, `last_activity`. Створюється автоматично при першому записі в проєкт; `last_activity` рухається тільки вперед.

Індекси `summaries` і `sessions` не потрібні: summary — шаблон, транскрипти залишаються на пристрої.

---

## 6. MCP-інтерфейс

Сервер **самоописовий**: уся поведінкова інструкція живе в `instructions` і описах тулів, тому працює однаково в claude.ai, Claude Code і Claude Desktop без жодних налаштувань на боці клієнта.

### 6.1 Чому це працює

Кожен MCP-клієнт передає Claude: server `instructions` (з `initialize`), `name` + `description` + JSON-схему кожного тулу, лістинг resources і prompts. Тригерного рушія немає — Claude вирішує викликати тул, читаючи ці тексти. Тому:

- описи пишуться як **тригери** («ALWAYS call before X»), не як фічі («allows searching»);
- перший тул, який Claude має викликати, **не має обов'язкових аргументів** — щоб не було приводу вагатися;
- `instructions` дублює ті самі правила для клієнтів, які його поважають.

### 6.2 Server `instructions`

Текст — в [src/mcp/instructions.ts](src/mcp/instructions.ts) як єдина константа, щоб тест на дрейф міг її зафіксувати:

```text
This server is the user's long-term memory across all their projects and conversations. …

Use it proactively, without being asked:
1. At the start of every conversation, call memory_summary with no arguments …
2. Before answering anything about the user's projects … call memory_recall …
3. Whenever the user states a decision, a preference, a durable fact … call memory_remember immediately.
4. If memory_recall returns nothing relevant, say so explicitly rather than guessing.

Never assume you remember something this server did not return.

Memory is stored in English. …
```

Ім'я сервера — `memory` (не `claude-memory`, не `brain`), тому тули рендеряться як `memory_*` і префікс сам себе документує.

### 6.3 Тули

| Тул | Роль |
|---|---|
| `memory_summary` | **Точка входу.** Без обов'язкових аргументів (`project?`, `days?`). Повертає шаблонну хронологію. |
| `memory_recall` | Пошук. Query **англійською** — тул сам вимагає перекласти питання. |
| `memory_remember` | Запис. `content` англійською; `type=episode` бере структурований об'єкт `episode`. |
| `memory_update` | Правка за id; `status: "done"` закриває todo. |
| `memory_forget` | Soft delete за id або фільтром. |

`memory_ingest` з v1 **видалено** — екстракція відбувається в Claude Code.

Формат `memory_summary`:

```markdown
## Last 30 days
- 2026-08-20 · getcheckout · Fixed country-detection cookie precedence. Deferred: Adyen multi-currency.
- 2026-08-18 · open-chance · Confirmed GSC indexing works after cold start.

## Open todos
- [getcheckout] Decide Adyen vs Shopify Payments on the OÜ entity.

## Preferences
- Answer in the language the user writes in; keep replies concise.

Call memory_recall for details on any item.
```

Останній рядок навмисний — він підштовхує наступний виклик. Один рядок на episode: `occurred_at · project · did (перше речення)` + `Deferred: …` якщо є. Ліміт — `SUMMARY_MAX_EPISODES`.

### 6.4 Resources і prompt

| URI | Опис |
|---|---|
| `memory://summary` | Cross-project overview. Те саме, що `memory_summary`. **Статичний** (не template) — щоб клієнти могли автоприкріплювати. |
| `memory://projects` | Список проєктів. |
| `memory://projects/{project}/summary` | Хронологія одного проєкту. |
| `memory://preferences` | Як користувач любить працювати. |

Prompt `start_session` (Claude Code рендерить його як slash-команду) = вивід `memory_summary` + правила з §6.2 дослівно.

### 6.5 Правила формулювань

Треба:
- Починати з тригера: «ALWAYS call…», «REQUIRED before…», «Call IMMEDIATELY when…».
- Знімати причину пропустити виклик: «even if you believe you already know the answer».
- Казати, що буде без виклику: «Without this you do not know…».
- Пояснювати, що робити з опційними аргументами: «Omit if unsure».
- ≤ 400 символів на опис; перше речення несе рішення.

Не треба:
- «Allows you to», «can be used to», «helps with» — пасивно, ігнорується.
- Описувати реалізацію (OpenSearch, ембединги) — розмиває тригер.
- Дублювати правило більш ніж у двох місцях.

---

## 7. Пошук, rerank, дедуп

**Hybrid query** — BM25 + kNN в одному запиті через search pipeline `hybrid-rrf` (min-max нормалізація, ваги 0.4 / 0.6). Фільтр kNN ставиться **всередину** `knn`-клаузи, а не в обгортковий `bool`: інакше це post-filter, який тихо повертає менше за `k`. Fallback, якщо `hybrid` недоступний, — два запити + RRF у Node (визначається один раз на процес).

**Rerank у Node** після пошуку, за `occurred_at`:

```
episode:            score * exp(-ageDays / 90)
decision | fact:    score * exp(-ageDays / 180) * (1 + (importance - 3) * 0.1)
todo:               score * 1.2   (якщо status=active)
preference:         score         (без decay)
```

**Дедуп** — тільки для `decision | preference | todo | fact`. `content_hash` exact → update метаданих; інакше kNN top-5 у тому ж `project` + `type`, cosine ≥ `DEDUPE_THRESHOLD` → supersede старого. Cosine рахується в Node зі збереженого вектора, а не з `_score`: шкала `_score` залежить від рушія k-NN.

`episode` **не дедуплікується ніколи** — кожна сесія це окремий запис журналу.

Поріг 0.90 — стартовий для bge. Перевірити на 20–30 реальних фактах і підкрутити.

---

## 8. REST API

Bearer на всіх, крім `/health`.

| Метод | Шлях | Призначення |
|---|---|---|
| `POST\|GET\|DELETE` | `/mcp` | Streamable HTTP MCP transport |
| `POST` | `/api/ingest` | `{ episode?, facts?, project?, source?, occurred_at? }` → `{ episode_id?, project, facts: {created,updated,merged}, skipped }` |
| `GET` | `/api/summary?project=&days=` | те саме, що `memory_summary`, як `text/markdown` — для SessionStart-хука |
| `GET` | `/api/projects` | список з `last_activity` |
| `PUT` | `/api/projects/:slug` | `{ name?, aliases?, repo_names? }` — навчити сервер, який git remote це який проєкт |
| `GET` | `/health` | без auth; OpenSearch + готовність embedder |

`POST /api/ingest` проганяє кожен факт через той самий `core/remember.ts`, що й MCP-тул. Тіло приймається **тільки англійською** — сервер не перекладає.

---

## 9. Клієнт Claude Code

Повна інструкція — [claude-code/README.md](claude-code/README.md).

| Файл | Подія | Ефект |
|---|---|---|
| `hooks/memory-context.sh` | `SessionStart` | Друкує хронологію в контекст. Детерміновано, без участі моделі. |
| `hooks/memory-extract.sh` | `Stop` | Журналює сесію: один episode + до 5 фактів через `claude -p --model haiku`. |
| `commands/memory-log.md` | `/memory-log <text>` | Ручний запис, коли хук не спрацював. |
| `prompts/extract.txt` | — | Промпт екстракції. Редагувати тут, щоб змінити, що запам'ятовується. |

Три речі, які легко зламати й важко помітити:

- **Рекурсія.** `claude -p` усередині Stop-хука запускає сесію, яка знову викликає той самий Stop-хук. Дочірній процес іде з `MEMORY_HOOK_RUNNING=1` і виходить одразу.
- **Хук ніколи не фейлить сесію.** Усі шляхи закінчуються `exit 0`; `curl --max-time`, `timeout 120` на `claude -p`.
- **Екстракція йде у фоні** — хук повертається одразу, модель викликається detached, лог у `~/.claude/memory-extract.log`.

Сесії з менш ніж 400 символів прози не журналяться.

---

## 10. Конфігурація

| Змінна | Default | Нащо |
|---|---|---|
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | `trace`…`fatal`, `silent` |
| `MCP_TRANSPORT` | `http` | `stdio` — лише для MCP Inspector |
| `MCP_AUTH_TOKEN` | — | обов'язковий при `http`. `openssl rand -hex 32` |
| `OPENSEARCH_URL` | `http://localhost:9200` | |
| `INDEX_PREFIX` | `` | щоб кілька деплоїв ділили один кластер |
| `EMBED_MODEL` | `BAAI/bge-base-en-v1.5` | |
| `EMBED_DIM` | `768` | має збігатися з моделлю — перевіряється на старті |
| `EMBED_DTYPE` | `fp32` | `q8` вчетверо менше пам'яті, гірший recall |
| `MODEL_CACHE_DIR` | `/models` | volume, щоб не тягнути модель щоразу |
| `DEDUPE_THRESHOLD` | `0.90` | cosine, вище якого новий факт витісняє старий |
| `SUMMARY_DAYS` | `30` | глибина хронології |
| `SUMMARY_MAX_EPISODES` | `15` | рядків у хронології |
| `RECALL_DEFAULT_K` | `8` | |
| `DEFAULT_PROJECT` | `general` | коли проєкт не визначено |

Жорсткі ліміти в коді (`config.ts` → `LIMITS`): `content` ≤ 2000 символів, `recall.k` ≤ 30, тіло `/api/ingest` ≤ 2 MB, ≤ 500 фактів за раз, episode коротший за 40 символів пропускається.

---

## 11. Експлуатація

**Зміна моделі ембедингів** = `npm run reindex`. Скрипт перераховує всі вектори в новий індекс `memories-v<timestamp>` і друкує команду для alias-свопу; нічого не видаляє. Старі вектори несумісні з новою моделлю — без reindex пошук просто мовчки деградує.

**Бекап** — `scripts/backup.sh --register` один раз, далі `scripts/backup.sh` щоночі по cron. Snapshot у volume, тримає останні 14. Раз на тиждень — копія на Hetzner Object Storage.

**Логи** — pino JSON. Контент фактів редагується на рівні `info`: в логах тільки id і лічильники.

**Тести** — `npm test` (vitest). Покривають дедуп-нормалізацію, rerank-формули, формат хронології та описи тулів (снапшот, щоб будь-яка зміна формулювання була свідомим diff'ом).

**Ротація токена** — замінити `MCP_AUTH_TOKEN` в `.env`, `~/.claude/memory.env` на кожному пристрої та в конекторах claude.ai.

---

## 12. Зафіксовані рішення

- **Платні API — жодних.** Якщо якості bge-base не вистачить: спершу `bge-large-en-v1.5` (1024 dim, потребує reindex), і лише потім обговорювати Voyage.
- **English-only storage.** Переклад — обов'язок хука (`extract.txt`) і описів тулів.
- **Episode не дедуплікується.** Кожна сесія — окремий запис.
- **Summary — шаблон, без LLM.** `/memory-rebuild` з v2 прибрано.
- **Один користувач.** Поле `owner` у mapping не додається. Якщо з'явиться — міграція через `reindex.ts`.
- **stdio — лише dev.** У проді тільки Streamable HTTP.

---

## 13. Відхилення від первинних специфікацій

Три місця, де реалізація свідомо розходиться з текстом специфікацій:

1. **MCP SDK v2** (`@modelcontextprotocol/server`), а не v1 `@modelcontextprotocol/sdk`, як писали специфікації. У v2 є `WebStandardStreamableHTTPServerTransport`, який приймає `c.req.raw` напряму — Hono не потребує адаптера. Реєстрація тулів — `registerTool(name, { description, inputSchema }, cb)` замість `server.tool(name, desc, shape, cb)`.
2. **`memory_detect_project` не реалізовано.** Він є в self-describing-spec §4.4, але v3 не включив його ні в дерево файлів, ні в §5. Визначення проєкту робить `detect_project()` у `lib.sh` проти `GET /api/projects` — без моделі, як і решта хука.
3. **Опис `memory_remember` скорочено.** Дослівний текст spec §4.3 разом із доданим у v3 реченням про англійську дає 421 символ проти ліміту 400 з spec §8. Імперативну частину («Call IMMEDIATELY…», «Do not ask permission…») збережено дослівно, стиснуто речення про переклад.

Архів попередніх версій специфікації — [docs/archive/](docs/archive/).
