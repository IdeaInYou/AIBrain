
# Memory MCP — Patch: Linked Notes (автоматично, без участі моделі)

Мета: кожна сесія Claude Code залишає після себе **файл-нотатку в репо** і **запис у memory з посиланням на нього**. Обидва створюються хуком, а не моделлю. Архітектурна карта проєкту (`docs/memory/architecture.md`) оновлюється автоматично тим же хуком. Правила в `CLAUDE.md` — лише підсилення, не єдиний механізм.

Застосовується поверх v3 + попередніх правок (один episode на сесію, deferred → todo).

---

## 1. Принцип

| Що | Хто створює | Гарантія |
|---|---|---|
| `docs/memory/sessions/<date>-<session>.md` | `Stop`-хук | детерміновано |
| `docs/memory/decisions/<date>-<slug>.md` | `Stop`-хук, якщо екстрактор знайшов decision з importance ≥ 4 | детерміновано |
| `docs/memory/architecture.md` | `Stop`-хук, патч-режим (див. §5) | детерміновано |
| запис у memory з `refs` | `Stop`-хук | детерміновано |
| оновлення посеред сесії | Claude через `CLAUDE.md` | best-effort, бонус |

Якщо модель нічого не зробить — файли й записи все одно з'являться.

---

## 2. Сервер

### 2.1 Mapping `memories` — нові поля

```jsonc
"refs":  { "type": "keyword" },              // ["docs/memory/sessions/2026-08-22-a1b2.md"]
"note":  { "type": "text", "index": false }  // повний markdown нотатки, для клієнтів без репо
```

### 2.2 `memory_remember` / `POST /api/ingest`

Приймають `refs?: string[]` і `note?: string` (≤ 20 000 символів). Для episode хук завжди передає обидва.

### 2.3 `memory_recall` / `memory_summary`

У кожному результаті виводити `refs`. У summary — рядок episode закінчувати `→ <ref>`:
```
- 2026-08-22 · aibrain · Built and deployed memory MCP server. → docs/memory/sessions/2026-08-22-a1b2.md
```

### 2.4 Resource `memory://notes/{id}`

Повертає `note` записи як `text/markdown`. Це дає claude.ai / мобільному доступ до деталей без репо.

### 2.5 Описи (доповнення до spec)

`memory_remember`: додати *"If a note file exists in the repo for this item, pass its repo-relative path in refs. For detailed context pass the markdown in note."*

`memory_recall`: додати *"Results may include refs (file paths) — read them when the user needs details beyond the summary."*

---

## 3. Хук `memory-extract.sh` — розширення

Порядок після отримання JSON від `claude -p`:

```bash
repo="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0   # поза репо — лише memory, без файлів
date="$(date +%F)"; short="${session:0:4}"
dir="$repo/docs/memory"; mkdir -p "$dir/sessions" "$dir/decisions"

# 1. session note
sess_file="docs/memory/sessions/$date-$short.md"
render_session_md "$result" > "$repo/$sess_file"          # §4.1

# 2. decision notes (importance >= 4)
refs=("$sess_file")
for d in $(jq -c '.facts[] | select(.type=="decision" and .importance>=4)' <<<"$result"); do
  slug="$(jq -r .content <<<"$d" | slugify | cut -c1-48)"
  f="docs/memory/decisions/$date-$slug.md"
  [ -e "$repo/$f" ] || render_decision_md "$d" "$sess_file" > "$repo/$f"   # §4.2
  refs+=("$f")
done

# 3. architecture.md — патч (§5)
arch_delta="$(jq -r '.architecture_delta // empty' <<<"$result")"
[ -n "$arch_delta" ] && apply_arch_delta "$arch_delta" "$repo/docs/memory/architecture.md"

# 4. memory ingest з refs + note
jq -n --argjson r "$result" --arg p "$p" --arg s "$session" --arg d "$DEVICE" \
      --argjson refs "$(printf '%s\n' "${refs[@]}" | jq -R . | jq -s .)" \
      --rawfile note "$repo/$sess_file" \
  '$r + {project:$p, refs:$refs, note:$note,
         source:{kind:"hook", client:"claude-code", device:$d, session_id:$s}}' \
  | mem_post /api/ingest >/dev/null 2>&1 || true

# 5. commit (тільки docs/memory, не чіпає робоче дерево)
git -C "$repo" add docs/memory && \
git -C "$repo" diff --cached --quiet || \
git -C "$repo" commit -q -m "memory: session $date-$short" -- docs/memory || true
```

Повторний `Stop` у тій же сесії перезаписує `sessions/<date>-<short>.md` (ідемпотентно, як і episode на сервері).

`render_*` і `apply_arch_delta` — маленькі функції в `lib.sh` (bash + jq; якщо незручно — `node ~/.claude/hooks/render.mjs`).

---

## 4. Формати файлів

### 4.1 `sessions/<date>-<short>.md`

```markdown
---
date: 2026-08-22
project: aibrain
session: a1b2c3d4-...
device: laptop
---
# Session 2026-08-22 — <did, перше речення>

## What
<did>

## Why
<why>

## Outcome
<outcome>

## Deferred
<deferred або "—">

## Files
- src/core/remember.ts
- ...

## Facts recorded
- [decision] <content> (→ decisions/2026-08-22-<slug>.md)
- [todo] <content>
```

### 4.2 `decisions/<date>-<slug>.md` (ADR)

```markdown
---
date: 2026-08-22
project: aibrain
status: accepted
session: sessions/2026-08-22-a1b2.md
---
# <content, одне речення>

## Context
<why з episode>

## Decision
<content>

## Consequences
<outcome з episode; якщо є deferred — як "Follow-up">
```

Не редагується хуком повторно. Якщо рішення скасоване — Claude (або ти) міняє `status: superseded` і додає посилання на новий ADR.

---

## 5. `architecture.md` — автоматичне оновлення

Повне переписування файлу хуком небезпечне (втрата ручних правок). Тому — патч-режим.

### 5.1 Екстрактор повертає дельту

Додати в `extract.txt`:

```
Also return "architecture_delta": a list of changes to the project's architecture map that this session caused. Only structural facts: new/removed modules, changed responsibilities, new integrations, changed data flow, new env vars or services. Empty list if nothing structural changed.
"architecture_delta": [
  { "section": "Modules|Data flow|Integrations|Infrastructure|Config", "op": "add|remove|replace",
    "key": "short stable identifier, e.g. 'src/core/remember.ts' or 'OpenSearch'",
    "text": "one line, English" }
]
```

### 5.2 Формат `architecture.md`

Керовані блоки з маркерами; поза ними — вільний текст, який хук не чіпає:

```markdown
# AIBrain — Architecture

<!-- free text above is yours; hook never touches it -->

## Modules
<!-- memory:begin Modules -->
- src/core/remember.ts — dedupe + supersede logic, shared by MCP tool and REST
- src/search/hybrid.ts — BM25 + kNN with RRF fallback
<!-- memory:end Modules -->

## Data flow
<!-- memory:begin Data flow -->
...
<!-- memory:end Data flow -->

## Integrations
<!-- memory:begin Integrations -->
<!-- memory:end Integrations -->

## Infrastructure
<!-- memory:begin Infrastructure -->
<!-- memory:end Infrastructure -->

## Config
<!-- memory:begin Config -->
<!-- memory:end Config -->

_Last auto-update: 2026-08-22 (session a1b2)_
```

### 5.3 `apply_arch_delta`

Для кожного елемента: знайти блок `section`; рядки в блоці ідентифікуються по `key` (перший токен до ` — `). `add` — додати, якщо key відсутній; `replace` — замінити рядок з тим key; `remove` — видалити. Оновити футер. Якщо файла немає — створити зі скелетом §5.2 і застосувати дельту.

---

## 6. `CLAUDE.md` — блок для кожного репо

Підсилення, не основа. Додати:

```markdown
## Memory
- docs/memory/architecture.md is the current map of this project. Read it at the start of non-trivial work.
- docs/memory/decisions/ holds ADRs. Read the relevant ones before changing something they cover.
- When you make an architectural decision mid-session, call memory_remember (type decision) immediately;
  the session hook will create the ADR file afterwards — do not create it yourself.
- When architecture.md is wrong, fix it inside the marked blocks; free text outside markers is human-owned.
- Do not edit docs/memory/sessions/ — generated.
```

Третій пункт важливий: модель **не** пише файли сама, щоб не конфліктувати з хуком. Вона лише фіксує рішення в memory, файл з'явиться детерміновано.

---

## 7. `SessionStart`-хук — доповнення

Після хронології з сервера друкувати:
```
Architecture map: docs/memory/architecture.md (updated <date>)
Recent ADRs: <3 останні файли з decisions/>
```
Без вмісту — лише шляхи; `architecture.md` і так у контексті через `CLAUDE.md`-правило, якщо Claude його прочитає, а тут він ще й побачить, що воно свіже.

---

## 8. Поза репо / інші клієнти

- Сесія Claude Code поза git-репо → тільки запис у memory без файлів і без `refs`.
- claude.ai / мобільний → бачать `refs` як текст і можуть прочитати `note` через `memory://notes/{id}`. Для ADR з claude.ai: `memory_remember(type: decision, note: <markdown>)` — сервер збереже, файл у репо з'явиться при наступній сесії Claude Code (хук `SessionStart` синхронізує: `GET /api/notes?project=&missing_refs=true` → записати файли → оновити `refs`). Це окремий крок, реалізувати після основного.

---

## 9. Тест

1. Сесія в репо з одним реальним рішенням → після виходу: є `sessions/<date>-<short>.md`, є `decisions/<date>-<slug>.md`, `architecture.md` має змінений блок, коміт `memory: session …`, на сервері episode з `refs` і `note`.
2. Новий чат у Claude Desktop: `memory_summary` показує `→ docs/memory/sessions/…`; `memory_recall` повертає `refs`; resource `memory://notes/<id>` віддає markdown.
3. Повторний `Stop` у тій же сесії → файл і episode оновлені, не продубльовані.
4. Ручний текст над маркерами в `architecture.md` — недоторканий після хука.