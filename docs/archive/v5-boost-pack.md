# Memory MCP — Patch: Boost Pack

Мета: memory перестає бути «довідкою на старті» і стає підказкою **в момент дії**, з кількома незалежними джерелами правди й самоконтролем якості. Усе детерміноване (хуки, git, cron), модель — лише бонус.

Застосовується поверх v3 + патчів «один episode на сесію», «deferred → todo», «linked notes». Порядок впровадження — §10.

---

## 1. Pre-tool recall — контекст перед зміною файлу

Найбільший ефект. Claude бачить історію файлу рівно тоді, коли збирається його міняти.

### 1.1 Хук

`~/.claude/settings.json`:
```json
"PreToolUse": [{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [{ "type": "command", "command": "~/.claude/hooks/memory-pretool.sh", "timeout": 5 }]
}]
```

`hooks/memory-pretool.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail; source "$HOME/.claude/hooks/lib.sh"
payload="$(cat)"
file="$(jq -r '.tool_input.file_path // empty' <<<"$payload")"
[ -z "$file" ] && exit 0
repo="$(git rev-parse --show-toplevel 2>/dev/null)"; rel="${file#$repo/}"

# кеш на сесію: один файл — один запит
cache="/tmp/memory-pretool-$(jq -r .session_id <<<"$payload")"
mkdir -p "$cache"; key="$(printf '%s' "$rel" | md5sum | cut -c1-16)"
[ -e "$cache/$key" ] && exit 0; touch "$cache/$key"

out="$(mem_get "/api/file-context?path=$(urlencode "$rel")&k=3" 2>/dev/null)"
[ -z "$out" ] || [ "$out" = "[]" ] && exit 0

# stdout → додається в контекст Claude перед виконанням тулу
jq -r '"[memory] History of \(.path):\n" + (.items[] | "- \(.date) · \(.summary)" + (if .why != "" then " — because: \(.why)" else "" end) + (if .ref != "" then " → \(.ref)" else "" end)) ' <<<"$out"
exit 0
```

Вивід хука в stdout з exit 0 додається в контекст; тул виконується далі. Ліміт 3 записи, ≤ 6 рядків — щоб не роздувати контекст.

### 1.2 Сервер: `GET /api/file-context?path=&k=`

Пошук по `episode.files` (exact + prefix по директорії) і `refs`, сортування за `occurred_at desc`, плюс decisions, що згадують шлях у `content`. Повертає:
```json
{ "path": "src/core/remember.ts", "items": [
  { "date": "2026-08-22", "type": "episode", "summary": "<did, перше речення>", "why": "<why>", "ref": "docs/memory/sessions/2026-08-22-a1b2.md", "id": "…" }
]}
```
Кешувати на сервері 60 с (один файл під час сесії редагується багато разів).

### 1.3 Той самий механізм для `Bash`

`matcher: "Bash"`, якщо команда містить `docker compose|traefik|deploy|migrate` → `GET /api/recall?q=<команда>&type=episode,decision&k=2`. Ловить «минулого разу деплой зламався через X».

---

## 2. Git як друге джерело правди

Покриває роботу без Claude Code і робить `files` точними.

### 2.1 `post-commit` хук (через `core.hooksPath` або `husky`, один раз на репо)

```bash
#!/usr/bin/env bash
source "$HOME/.claude/hooks/lib.sh" 2>/dev/null || exit 0
msg="$(git log -1 --pretty=%B)"; [[ "$msg" == memory:* ]] && exit 0   # не журналити свої коміти
files="$(git diff-tree --no-commit-id --name-only -r HEAD | head -30 | jq -R . | jq -s .)"
stat="$(git diff-tree --no-commit-id --shortstat -r HEAD)"
p="$(detect_project)"
jq -n --arg m "$msg" --arg s "$stat" --argjson f "$files" --arg p "${p:-general}" \
      --arg sha "$(git rev-parse --short HEAD)" --arg d "$DEVICE" \
  '{project:$p, commit:{sha:$sha, message:$m, stat:$s, files:$f},
    source:{kind:"git", client:"git", device:$d}}' \
  | mem_post /api/ingest/commit >/dev/null 2>&1 &
exit 0
```

### 2.2 Сервер: `POST /api/ingest/commit`

- Якщо за останні 2 години є episode з того ж `project` і `device` → **прикріпити** коміт до нього: `episode.commits[] += {sha, message}`, `episode.files` = union. Не створювати новий запис.
- Інакше → створити легкий `episode` з `did = message`, `files`, `source.kind = git`, `importance = 2`.

Mapping: `episode.commits: {sha: keyword, message: text}`.

Результат: episode з транскрипту каже «нащо», коміти кажуть «що саме» — і вони зв'язані автоматично.

---

## 3. Зв'язки між записами

### 3.1 Поле `related: keyword[]`

При `remember` (після ембедингу): kNN top-5 по всіх типах у тому ж `project`, cosine ≥ 0.75, виключаючи себе → записати ids у `related`. Двосторонньо: у знайдених додати новий id (bulk update).

### 3.2 У `recall`

Для top-3 результатів підтягувати `related` (лише `id`, `type`, перше речення) як `see_also`. У тексті результату:
```
… score 0.86
  see also: [decision] Chose MCP SDK v2 … · [todo] Register project repos …
```

### 3.3 Ланцюжок todo

`todo` з `source.session_id` = A, закритий у сесії B (`memory_update status:done` або екстрактор побачив, що deferred зник) → `related` між episode A і episode B. Відповідає на «коли ми це доробили?».

---

## 4. Точність пошуку

### 4.1 Reranker

`BAAI/bge-reranker-base` (ONNX, ~280 MB, CPU ~40 мс на пару). Pipeline: hybrid → top-24 → reranker → top-k. Додати в `embed/` як `reranker.ts`, прогрів на старті. Конфіг `RERANK_ENABLED=true`, `RERANK_CANDIDATES=24`. Відчутно менше шуму, особливо на коротких запитах.

### 4.2 Чанки для `note`

`note` зараз не шукається. Індекс `chunks`: `{memory_id, project, chunk_idx, text, embedding}`, нарізка по ~400 токенів з overlap 60. У hybrid-запиті — другий пошук по `chunks`, результати агрегуються в батьківський `memory_id` (max score). Так деталі з ADR і session notes знаходяться, а видається цілісний запис.

### 4.3 Usage-буст

`access_count` і `last_accessed` вже є. У rerank: `score *= 1 + min(access_count, 10) * 0.02`. Записи, які вже виявилися корисними, трохи вище.

### 4.4 Query expansion (дешево)

Для запитів ≤ 3 слів — додати в BM25 `should` з синонімами з таблиці проєкту (`projects.vocab`: `{"np": "nova poshta", "gc": "getcheckout", "cf": "cloudflare"}`). Таблицю наповнює `/memory-vocab add np "nova poshta"` або автоматично з тегів.

---

## 5. Інші джерела

### 5.1 Claude.ai-чати

`/memory-import <path-to-export.json>` у Claude Code: парсить експорт, для кожної розмови довшої за 400 символів — `extract.txt` через `claude -p`, `POST /api/ingest` з `source.client = claude-ai`, `occurred_at` = дата чату. Дедуп по `source.session_id = <chat uuid>` — повторний імпорт безпечний. Закриває дірку, що claude.ai-розмови пишуться лише через `memory_remember`.

### 5.2 Calendar / Gmail (опційно, окремий воркер)

- Calendar: події з ключовим словом у назві (`[mem]`) або з учасниками з `projects.contacts` → `fact`/`episode` з `why` = опис події.
- Gmail: ярлик `to-memory` → лист стає `fact` (тема + перші 500 символів, англійською через `claude -p`).

Воркер — невеликий Node-скрипт на VPS з cron кожні 15 хв, використовує ті ж Google-конектори, що й Claude. Реалізувати останнім.

---

## 6. Дайджест

### 6.1 Тижневий

Cron на VPS (без LLM) щопонеділка: `GET /api/digest?week=` → markdown:
```
# Week 2026-W34
## aibrain (4 sessions, 11 commits)
- 08-22 Built and deployed memory MCP server → sessions/…
## open-chance (1 session)
…
## Open todos (7) · oldest: 2026-07-30 "Register project repos"
## Decisions this week (3)
## Needs attention: 2 episodes without refs, 1 stale todo > 60d
```
Доставка: Telegram-бот (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` в `.env`) або email. Також зберігається як `memory://digest/2026-W34`.

### 6.2 У репо

Той самий markdown → `docs/memory/weekly/2026-W34.md` при наступному `SessionStart` у репо (хук забирає з сервера, якщо файлу немає, комітить).

---

## 7. Self-healing (нічний job на сервері, без LLM)

Результат → секція «Needs attention» у дайджесті + resource `memory://health`.

| Перевірка | Дія |
|---|---|
| episode без `refs` старший 1 дня | список; хук `SessionStart` у відповідному репо допише файл заднім числом |
| todo `active` > 60 днів | список |
| decision vs новіший decision у тому ж project, cosine > 0.85 | позначити обидва `needs_review: true`; показати пару — можливо суперечність |
| дублікати episode по `session_id` (регресія) | auto-supersede старіших |
| `architecture.md` не оновлювався 30 днів при ≥ 5 сесіях | нагадати |
| записи з `project = general` > 20 | нагадати розподілити (`/memory-reassign`) |

---

## 8. Контекст-бюджет

Щоб буст не роздув контекст:

| Джерело | Ліміт |
|---|---|
| `SessionStart` summary | ≤ 40 рядків |
| `PreToolUse` на файл | ≤ 6 рядків, 1 раз на файл на сесію |
| `PreToolUse` на Bash | ≤ 3 рядки, лише для matcher-команд |
| `recall` результат | k ≤ 8 + see_also ≤ 3 |

Конфіг `CONTEXT_BUDGET_LINES` на сервері, хуки обрізають за ним.

---

## 9. Метрики (щоб бачити, чи воно працює)

Індекс `events`: `{ts, kind: recall|summary|pretool|remember|ingest, client, k, hits, latency_ms, query_len}`. Без контенту.

`GET /api/stats?days=7` → у дайджест:
- recalls/день, середній top-score, частка recall з 0 результатів (> 30% = проблема з query або даними)
- pretool hits/misses
- записів створено по source.kind

Якщо recall з 0 результатів високий — перевіряти §4.4 vocab і якість `content`.

---

## 10. Порядок впровадження

1. **§1 Pre-tool recall** — `/api/file-context` + хук. Один день, найбільший ефект.
2. **§2 Git-хук** — `/api/ingest/commit` + прикріплення до episode.
3. **§3 related** — поле + авто-лінк при remember + see_also у recall.
4. **§9 метрики** — щоб далі міряти, а не вгадувати.
5. **§4.1 reranker** → **§4.2 chunks** → **§4.3/4.4**.
6. **§6 дайджест** + **§7 self-healing** (разом, бо self-healing живить дайджест).
7. **§5.1 імпорт claude.ai** — коли накопичиться.
8. **§5.2 Calendar/Gmail** — якщо буде потреба.

---

## 11. Тести

- Pre-tool: відредагувати файл, який є в `episode.files` вчорашньої сесії → у контексті з'явився блок `[memory] History of …` до виконання Edit. Повторна правка того ж файлу — блоку немає (кеш).
- Git: коміт без Claude Code → на сервері episode з `source.kind=git`; коміт під час сесії Claude Code → прикріпився до поточного episode, новий не створений.
- Related: два записи про одне рішення → у `recall` другий з'являється у see_also першого.
- Reranker: фікстура з 30 записів, 10 запитів з відомим правильним id; до/після — позиція правильної відповіді в середньому покращилась.
- Дайджест: cron виконався, markdown у Telegram і в `memory://digest/…`.
- Бюджет: за сесію з 20 правками файлів сумарний memory-вивід у контекст ≤ 100 рядків.