/**
 * Recall quality against a live server: each case is a paraphrased question and
 * a regex the right record's text must match. Reports hit@1/3/5 and MRR@10.
 *
 *   MEMORY_URL=… MEMORY_TOKEN=… npx tsx scripts/eval-recall.ts [eval/recall-cases.json]
 *
 * Talks to the REST API only, so it measures exactly what clients get.
 */
import { readFileSync } from 'node:fs';

interface Case {
  query: string;
  expect: string;
  project?: string;
}

interface Item {
  id: string;
  type: string;
  project: string;
  summary: string;
}

const url = process.env.MEMORY_URL;
const token = process.env.MEMORY_TOKEN;
if (!url || !token) {
  console.error('MEMORY_URL and MEMORY_TOKEN are required');
  process.exit(2);
}

const K = 10;
const cases = JSON.parse(readFileSync(process.argv[2] ?? 'eval/recall-cases.json', 'utf8')) as Case[];

let mrr = 0;
const hitsAt = { 1: 0, 3: 0, 5: 0 };

for (const c of cases) {
  const qs = new URLSearchParams({ q: c.query, k: String(K), ...(c.project ? { project: c.project } : {}) });
  const res = await fetch(`${url}/api/recall?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`HTTP ${res.status} for "${c.query}"`);
    process.exit(1);
  }
  const { items } = (await res.json()) as { items: Item[] };
  const re = new RegExp(c.expect, 'i');
  const rank = items.findIndex(i => re.test(i.summary)) + 1;

  if (rank > 0) mrr += 1 / rank;
  for (const k of [1, 3, 5] as const) if (rank > 0 && rank <= k) hitsAt[k]++;

  const mark = rank === 1 ? 'ok ' : rank > 0 ? `@${rank} ` : 'MISS';
  const top = items[0] ? `${items[0].type}: ${items[0].summary.slice(0, 70)}` : '(no results)';
  console.log(`${mark.padEnd(4)} ${c.query}\n       top → ${top}`);
}

const n = cases.length;
const pct = (x: number) => `${((x / n) * 100).toFixed(0)}%`;
console.log(
  `\n${n} cases · hit@1 ${pct(hitsAt[1])} · hit@3 ${pct(hitsAt[3])} · hit@5 ${pct(hitsAt[5])} · MRR@${K} ${(mrr / n).toFixed(3)}`,
);
