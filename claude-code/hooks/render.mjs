#!/usr/bin/env node
/**
 * Renders the note files the Stop hook writes, and patches architecture.md.
 *
 *   render.mjs session <outPath>      < {result, meta}      -> writes session note
 *   render.mjs adr     <outPath>      < {decision, episode, meta} -> writes/updates an ADR
 *   render.mjs arch    <archPath>     < {delta, meta}       -> patches managed blocks
 *
 * Node rather than bash+jq because the ADR regeneration rules and the
 * architecture.md block patching are genuinely fiddly, and because `flock` does
 * not exist on macOS — the lock here is portable.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , command, target] = process.argv;

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const dash = (v) => s(v) || '—';

export function slugify(text) {
  return s(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'decision';
}

/* ------------------------------------------------------------ locking */

/**
 * Atomic lock via O_EXCL. Portable (no flock), with a stale-lock escape so a
 * killed hook cannot wedge every future session.
 */
function withLock(path, fn, { timeoutMs = 5000, staleMs = 60_000 } = {}) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const started = Date.now();

  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // vanished between check and stat — retry
      }
      if (age > staleMs) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for ${lock}`);
      }
      // Busy-wait briefly; contention here is two sessions in one repo, rare.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/* ------------------------------------------------------- frontmatter */

function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: text.slice(match[0].length) };
}

/* ---------------------------------------------------------- session */

function renderSession({ result, meta }) {
  const ep = result.episode ?? {};
  const facts = Array.isArray(result.facts) ? result.facts : [];
  const files = Array.isArray(ep.files) ? ep.files.slice(0, 10) : [];

  const firstSentence = (t) => {
    const trimmed = s(t);
    const m = /^(.+?[.!?])(\s|$)/s.exec(trimmed);
    return (m?.[1] ?? trimmed).trim();
  };

  const factLines = facts.length
    ? facts
        .map((f) => {
          const ref = meta.adrByContent?.[f.content];
          return `- [${f.type}] ${s(f.content)}${ref ? ` (→ ${ref})` : ''}`;
        })
        .join('\n')
    : '- (none)';

  return `---
date: ${meta.date}
project: ${meta.project}
session: ${meta.session}
device: ${meta.device}
generated: true
---
# Session ${meta.date} — ${firstSentence(ep.did) || 'Untitled session'}

## What
${dash(ep.did)}

## Why
${dash(ep.why)}

## Outcome
${dash(ep.outcome)}

## Deferred
${dash(ep.deferred)}

## Files
${files.length ? files.map((f) => `- ${f}`).join('\n') : '- (none recorded)'}

## Facts recorded
${factLines}
`;
}

/* -------------------------------------------------------------- ADR */

function renderAdrBody({ decision, episode, meta }) {
  const followUp = s(episode?.deferred) ? `\n\n**Follow-up:** ${s(episode.deferred)}` : '';
  return `# ${s(decision.content)}

## Context
${dash(episode?.why)}

## Decision
${s(decision.content)}

## Consequences
${dash(episode?.outcome)}${followUp}
`;
}

function writeAdr(path, payload) {
  const { decision, meta } = payload;
  const frontmatter = `---
date: ${meta.date}
project: ${meta.project}
status: accepted
session: ${meta.sessionRef}
session_id: ${meta.session}
generated: true
---
`;

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, frontmatter + renderAdrBody(payload));
    return 'created';
  }

  const existing = readFileSync(path, 'utf8');
  const { data } = parseFrontmatter(existing);

  // Untouched by a human: safe to regenerate wholesale.
  if (data.generated === 'true' && data.status === 'accepted' && data.session_id === meta.session) {
    writeFileSync(path, frontmatter + renderAdrBody(payload));
    return 'regenerated';
  }

  // A human edited it — never overwrite. Append the newer take instead, so the
  // divergence is visible rather than silently resolved either way.
  const revision = `\n\n## Revision ${meta.date}\n\n${renderAdrBody(payload)
    .replace(/^# .*\n/, '')
    .trim()}\n`;
  if (existing.includes(`## Revision ${meta.date}`)) return 'skipped';
  writeFileSync(path, existing.replace(/\s*$/, '') + revision);
  return 'revised';
}

/* ----------------------------------------------------- architecture */

const SECTIONS = ['Modules', 'Data flow', 'Integrations', 'Infrastructure', 'Config'];

function skeleton() {
  const blocks = SECTIONS.map(
    (name) => `## ${name}\n<!-- memory:begin ${name} -->\n<!-- memory:end ${name} -->`,
  ).join('\n\n');
  return `# Architecture\n\n<!-- Free text above and outside the marked blocks is yours; the hook never touches it. -->\n\n${blocks}\n`;
}

/** Managed lines carry their key in a trailing comment — never parse the prose. */
const keyOf = (line) => /<!--\s*k:(.+?)\s*-->\s*$/.exec(line)?.[1] ?? null;
const managedLine = (text, key) => `- ${s(text)} <!-- k:${key} -->`;

function applyArchDelta(path, { delta, meta }) {
  if (!Array.isArray(delta) || delta.length === 0) return 'no-op';

  let text = existsSync(path) ? readFileSync(path, 'utf8') : skeleton();
  let changed = false;

  for (const item of delta) {
    const section = SECTIONS.includes(item.section) ? item.section : 'Modules';
    const key = s(item.key);
    if (!key) continue;

    const begin = `<!-- memory:begin ${section} -->`;
    const end = `<!-- memory:end ${section} -->`;
    let bi = text.indexOf(begin);
    if (bi === -1) {
      // Section missing entirely — append it rather than dropping the delta.
      text = `${text.replace(/\s*$/, '')}\n\n## ${section}\n${begin}\n${end}\n`;
      bi = text.indexOf(begin);
    }
    const ei = text.indexOf(end, bi);
    if (ei === -1) continue;

    const head = text.slice(0, bi + begin.length);
    const tail = text.slice(ei);
    const lines = text
      .slice(bi + begin.length, ei)
      .split('\n')
      .filter((l) => l.trim().length > 0);

    const idx = lines.findIndex((l) => keyOf(l) === key);

    if (item.op === 'remove') {
      if (idx !== -1) {
        lines.splice(idx, 1);
        changed = true;
      }
    } else if (item.op === 'replace') {
      const next = managedLine(item.text, key);
      if (idx === -1) {
        lines.push(next);
        changed = true;
      } else if (lines[idx] !== next) {
        lines[idx] = next;
        changed = true;
      }
    } else {
      // add — never duplicate an existing key
      if (idx === -1) {
        lines.push(managedLine(item.text, key));
        changed = true;
      }
    }

    text = `${head}\n${lines.join('\n')}${lines.length ? '\n' : ''}${tail}`;
  }

  if (!changed) return 'no-op';

  const footer = `_Last auto-update: ${meta.date} (session ${meta.short})_`;
  text = /_Last auto-update: .*_/.test(text)
    ? text.replace(/_Last auto-update: .*_/, footer)
    : `${text.replace(/\s*$/, '')}\n\n${footer}\n`;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return 'patched';
}

/* -------------------------------------------------------------- main */

const payload = readStdin();

switch (command) {
  case 'session': {
    const md = renderSession(payload);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, md);
    process.stdout.write('written\n');
    break;
  }
  case 'adr':
    process.stdout.write(`${writeAdr(target, payload)}\n`);
    break;
  case 'arch':
    process.stdout.write(`${withLock(target, () => applyArchDelta(target, payload))}\n`);
    break;
  default:
    process.stderr.write(`unknown command: ${command}\n`);
    process.exit(1);
}
