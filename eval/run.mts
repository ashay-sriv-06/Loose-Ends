// Evaluation runner. Usage:
//   npx tsx eval/run.mts                 validators + rules extraction + transformations
//   LOOSE_ENDS_MODEL=qwen3.5:4b npx tsx eval/run.mts --ai     also evaluates model extraction (live calls)
// Compares against eval/expected/answer-key.json, which was written before the first run.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Requirement, Run } from '../src/domain/model.ts';
import { LocalFsAdapter } from '../src/engine/adapter.ts';
import { BOUNDARY_REQUIREMENT_ID, builtInRequirements, derivePredicate, looksBinary, requirementId, resolveAuthority, subjectKeyOf } from '../src/engine/extract.ts';
import { assessFreshness, diffRuns } from '../src/engine/freshness.ts';
import { acceptProposals, askModel, modelConfigFromEnv } from '../src/engine/model.ts';
import { executeRun, proposeRequirements, type RunOptions } from '../src/engine/run.ts';
import { build, makeJpeg, put, svg, type EvalCase } from './cases.ts';

interface Gold {
  line: string;
  applicability: 'required' | 'conditional' | 'optional';
  expect: string;
  type: string;
  mustMention?: string;
}
interface CaseKey {
  readiness: string;
  readinessMustNotBe?: string;
  gold: Gold[];
  notCommitments: string[];
  ambiguous: string[];
  boundary: { source: string; expect: 'failed' | 'none'; target?: string }[];
  decisions?: Record<string, { readiness: string; hero: string }>;
}
const HELDOUT = process.argv.includes('--heldout');
const key = JSON.parse(await fs.readFile(new URL(HELDOUT ? './expected/answer-key-heldout.json' : './expected/answer-key.json', import.meta.url), 'utf8')) as { cases: Record<string, CaseKey> };
const AI = process.argv.includes('--ai');
const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'loose-ends-eval-')));
const adapterOf = (c: EvalCase) => new LocalFsAdapter({ id: 'eval', label: 'eval', kind: 'local-actual', absPath: c.root });
const READY = 'Ready on checked items';
const strip = (raw: string) => raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\s*>\s?/, '').trim();

// ---------- helpers ----------

/** Requirements built from the answer key's lines, as a person entering them by hand would get. Isolates validators from extraction. */
async function goldRequirements(c: EvalCase, k: CaseKey): Promise<Requirement[]> {
  const texts = new Map<string, string[]>();
  for (const b of c.briefs) texts.set(b, (await fs.readFile(path.join(c.root, b), 'utf8').catch(() => '')).split(/\r?\n/).map(strip));
  const reqs: Requirement[] = [];
  let briefBoundary = false;
  for (const g of k.gold) {
    const src = [...texts].find(([, lines]) => lines.includes(g.line));
    if (!src) throw new Error(`answer key line not in any brief of ${c.id}: ${g.line}`);
    const predicate = derivePredicate(g.line);
    const r: Requirement = {
      id: requirementId(src[0], g.line),
      text: g.line,
      sourceId: src[0],
      sourcePath: src[0],
      excerpt: g.line,
      location: { line: src[1].indexOf(g.line) + 1 },
      predicate,
      applicability: g.applicability,
      authority: 'authoritative',
      origin: 'manual',
      subjectKey: subjectKeyOf(predicate),
      enabled: true,
    };
    if (predicate.type === 'references-resolve') {
      briefBoundary = true;
      reqs.push({ ...r, id: BOUNDARY_REQUIREMENT_ID, subjectKey: 'boundary' });
    } else reqs.push(r);
  }
  return [...reqs, ...builtInRequirements().filter((b) => !(briefBoundary && b.id === BOUNDARY_REQUIREMENT_ID))];
}

async function runWith(c: EvalCase, requirements: Requirement[], decisions: Record<string, string> = {}, opts: RunOptions = {}): Promise<Run> {
  return executeRun(adapterOf(c), { projectName: c.id, rootId: 'eval', deliveryPath: c.delivery, briefPaths: c.briefs, approvalPaths: c.approvals, requirements, extractionMode: 'manual', authorityDecisions: decisions }, opts);
}

const BLOCKING = ['failed', 'not-found-in-scope'];
function fold(run: Run, reqId: string): string {
  const cs = run.checks.filter((x) => x.requirementId === reqId);
  if (!cs.length) return 'no-check';
  const b = cs.find((x) => BLOCKING.includes(x.outcome));
  if (b) return b.outcome;
  if (cs.every((x) => x.outcome === 'verified')) return 'verified';
  return cs.find((x) => x.outcome !== 'verified')!.outcome;
}
function goldOutcome(run: Run, c: EvalCase, g: Gold, reqs: Requirement[]): { observed: string; text: string; predicate: string } {
  const r = reqs.find((x) => x.text === g.line)!;
  const cs = run.checks.filter((x) => x.requirementId === r.id);
  return { observed: fold(run, r.id), text: cs.map((x) => `${x.title} ${x.observed} ${x.evidence.map((e) => e.detail).join(' ')}`).join(' '), predicate: r.predicate.type };
}
function matches(expect: string, observed: string): boolean {
  if (expect === 'blocking') return BLOCKING.includes(observed);
  if (expect === 'not-blocking') return !BLOCKING.includes(observed);
  if (expect === 'open-not-blocking') return observed !== 'verified';
  if (expect === 'unresolved') return observed !== 'verified' && !BLOCKING.includes(observed);
  return expect === observed;
}
function boundaryFailed(run: Run, source: string): boolean {
  return run.checks.some((x) => x.requirementId === BOUNDARY_REQUIREMENT_ID && x.outcome === 'failed' && (x.relatedPaths.includes(source) || x.inspected.some((i) => i.path === source) || x.observed.includes(source)));
}
async function copyCase(c: EvalCase, tag: string): Promise<EvalCase> {
  const root = path.join(base, `${c.id}-${tag}`);
  await fs.cp(c.root, root, { recursive: true });
  return { ...c, root: await fs.realpath(root) };
}

// ---------- Track V: validators, given the answer key's promises ----------

interface Row {
  case: string;
  what: string;
  type: string;
  expected: string;
  observed: string;
  ok: boolean;
  class: 'TP' | 'TN' | 'FP' | 'FN' | 'wrong-kind' | 'n/a';
  note?: string;
}
const rowsV: Row[] = [];
const readiness: { case: string; track: string; expected: string; observed: string; ok: boolean }[] = [];
const cases: Record<string, EvalCase> = {};
const baseline: Record<string, { run: Run; reqs: Requirement[] }> = {};

const classify = (expect: string, observed: string, applicability: string): Row['class'] => {
  if (applicability !== 'required' || expect === 'not-blocking') return 'n/a';
  const expProblem = expect !== 'verified';
  const obsProblem = observed !== 'verified';
  if (expProblem && obsProblem) return matches(expect, observed) ? 'TP' : 'wrong-kind';
  if (!expProblem && !obsProblem) return 'TN';
  return obsProblem ? 'FP' : 'FN';
};

for (const id of Object.keys(key.cases)) {
  const k = key.cases[id];
  const c = (cases[id] = await build(id, base));
  const reqs = await goldRequirements(c, k);
  const run = await runWith(c, reqs);
  baseline[id] = { run, reqs };
  for (const g of k.gold) {
    const o = goldOutcome(run, c, g, reqs);
    let ok = matches(g.expect, o.observed);
    let note: string | undefined;
    if (g.type !== o.predicate) note = `promise was mapped to a “${o.predicate}” check, key expected “${g.type}”`;
    if (ok && g.mustMention && !o.text.includes(g.mustMention)) {
      ok = false;
      note = `did not mention ${g.mustMention}`;
    }
    rowsV.push({ case: id, what: g.line, type: g.type, expected: g.expect, observed: o.observed, ok, class: classify(g.expect, o.observed, g.applicability), ...(note ? { note } : {}) });
  }
  for (const b of k.boundary) {
    const failed = boundaryFailed(run, b.source);
    const ok = failed === (b.expect === 'failed');
    rowsV.push({ case: id, what: `references from ${b.source}`, type: 'references-resolve', expected: b.expect, observed: failed ? 'failed' : 'none', ok, class: b.expect === 'failed' ? (failed ? 'TP' : 'FN') : failed ? 'FP' : 'TN' });
  }
  readiness.push({ case: id, track: 'validators (answer-key promises)', expected: k.readiness, observed: run.readiness.label, ok: run.readiness.label === k.readiness && run.readiness.label !== k.readinessMustNotBe });
}

// c6 with each authority decision
if (!HELDOUT) {
  const c = cases['c6-conflict'];
  const { reqs } = baseline['c6-conflict'];
  const q = resolveAuthority(reqs, {}, []).questions[0];
  for (const [name, exp] of Object.entries(key.cases['c6-conflict'].decisions ?? {})) {
    const follow = name.replace('follow ', '');
    if (!q) {
      readiness.push({ case: 'c6-conflict', track: `decision: ${name}`, expected: exp.readiness, observed: 'no authority question was raised', ok: false });
      continue;
    }
    const run = await runWith(c, reqs, { [q.subjectKey]: follow });
    const chosen = reqs.find((r) => r.sourcePath === follow && r.predicate.type === 'image-dimensions')!;
    const hero = fold(run, chosen.id);
    readiness.push({ case: 'c6-conflict', track: `decision: ${name} (hero ${hero}, expected ${exp.hero})`, expected: exp.readiness, observed: run.readiness.label, ok: run.readiness.label === exp.readiness && hero === exp.hero });
  }
}

// ---------- Track X: extraction (rules, and optionally the model) against the answer key ----------

interface XRow {
  case: string;
  method: string;
  run: number;
  gold: number;
  found: number;
  missed: string[];
  invented: string[];
  applicabilityConfusion: string[];
  ambiguous: string[];
  citationsValid: number;
  citations: number;
  discardedNotInBrief: number;
  ms: number;
  error?: string;
}
const rowsX: XRow[] = [];
const modelCfg = AI ? modelConfigFromEnv(process.env) : null;
if (AI && !modelCfg) throw new Error('--ai needs LOOSE_ENDS_MODEL');

async function extractEval(c: EvalCase, k: CaseKey, method: 'rules' | 'ai' | 'model-only', runNo: number, caseLabel = c.id): Promise<{ row: XRow; reqs: Requirement[] }> {
  const t = Date.now();
  const row: XRow = { case: caseLabel, method, run: runNo, gold: k.gold.length, found: 0, missed: [], invented: [], applicabilityConfusion: [], ambiguous: [], citationsValid: 0, citations: 0, discardedNotInBrief: 0, ms: 0 };
  let reqs: Requirement[] = [];
  try {
    if (method === 'model-only') {
      // The model's own proposals after the verbatim gate, without the fixed rules: this is the model measured by itself.
      for (const b of c.briefs) {
        const text = await fs.readFile(path.join(c.root, b), 'utf8');
        if (looksBinary(text)) continue;
        const m = acceptProposals(text, { id: b, path: b }, await askModel(modelCfg!, text), []);
        reqs.push(...m.added);
        row.discardedNotInBrief += m.stats.rejectedNotVerbatim + m.stats.rejectedInstruction;
      }
    } else {
      const p = await proposeRequirements(adapterOf(c), c.briefs, c.approvals, {}, method === 'ai' ? { mode: 'ai', model: { cfg: modelCfg! } } : { mode: 'rules' });
      reqs = p.requirements;
      row.discardedNotInBrief = p.model.discarded;
    }
  } catch (e) {
    row.error = `${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`;
  }
  row.ms = Date.now() - t;
  const got = reqs.filter((r) => r.origin !== 'built-in');
  const lines = new Map<string, string[]>();
  for (const b of c.briefs) lines.set(b, (await fs.readFile(path.join(c.root, b), 'utf8').catch(() => '')).split(/\r?\n/).map(strip));
  for (const g of k.gold) {
    const r = got.find((x) => x.text === g.line);
    if (!r) row.missed.push(g.line);
    else {
      row.found++;
      if (r.applicability !== g.applicability) row.applicabilityConfusion.push(`${g.line} — key: ${g.applicability}, got: ${r.applicability}`);
    }
  }
  for (const r of got) {
    if (r.location) {
      row.citations++;
      if (lines.get(r.sourcePath)?.[r.location.line - 1] === r.text) row.citationsValid++;
    }
    if (k.gold.some((g) => g.line === r.text)) continue;
    if (k.ambiguous.includes(r.text)) row.ambiguous.push(`${r.text} — extracted as ${r.applicability}${r.predicate.type === 'manual' ? ' (left for human review)' : ` (${r.predicate.type})`}`);
    else row.invented.push(r.text);
  }
  for (const a of k.ambiguous) if (!got.some((r) => r.text === a)) row.ambiguous.push(`${a} — not extracted`);
  return { row, reqs };
}

const e2e: Record<string, Run> = {};
for (const id of Object.keys(key.cases)) {
  const c = cases[id];
  const k = key.cases[id];
  const { row, reqs } = await extractEval(c, k, 'rules', 1);
  rowsX.push(row);
  const run = await runWith(c, reqs);
  e2e[id] = run;
  readiness.push({ case: id, track: 'end to end, fixed-rules extraction', expected: k.readiness, observed: run.readiness.label, ok: run.readiness.label === k.readiness });
  if (AI) {
    const reruns = ['c3-svg-omitted-asset', 'c4-misleading-name', 'c8-optional', 'h6-quantity-conflict', 'h8-optional-in-prose'].includes(id) ? 3 : 1;
    for (let n = 1; n <= reruns; n++) rowsX.push((await extractEval(c, k, 'model-only', n)).row);
    for (let n = 1; n <= 1; n++) {
      const a = await extractEval(c, k, 'ai', n);
      rowsX.push(a.row);
      if (n === 1 && !a.row.error) {
        const r = await runWith(c, a.reqs);
        readiness.push({ case: id, track: 'end to end, AI-assisted extraction (run 1)', expected: k.readiness, observed: r.readiness.label, ok: r.readiness.label === k.readiness });
      } else if (n === 1) readiness.push({ case: id, track: 'end to end, AI-assisted extraction (run 1)', expected: k.readiness, observed: `no extraction: ${a.row.error}`, ok: id === 'c7b-unsupported-brief' });
    }
  }
}

// ---------- Transformations and invariants ----------

const inv: { id: string; ok: boolean; detail: string }[] = [];
const record = (id: string, ok: boolean, detail: string) => inv.push({ id, ok, detail });
const outcomes = (run: Run, c: EvalCase, k: CaseKey, reqs: Requirement[]) => k.gold.map((g) => `${g.line.slice(0, 32)}=${goldOutcome(run, c, g, reqs).observed}`).join('; ');
const guard = async (id: string, fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    record(id, false, `threw: ${(e as Error).message.split('\n')[0]}`);
  }
};

const guardAll = guard;
const guardBase = async (id: string, fn: () => Promise<void>) => (HELDOUT ? undefined : guardAll(id, fn));
await guardBase('t1-rename-and-update-refs (c3)', async () => {
  const id = 'c3-svg-omitted-asset';
  const k = key.cases[id];
  const c = await copyCase(cases[id], 't1');
  const v = path.join(c.root, 'Deliverables (client)/vector');
  await fs.rename(path.join(v, 'textures/weave.png'), path.join(v, 'textures/weave – neu.png'));
  const badge = await fs.readFile(path.join(v, 'badge.svg'), 'utf8');
  await fs.writeFile(path.join(v, 'badge.svg'), badge.replace('textures/weave.png', 'textures/weave%20%E2%80%93%20neu.png'));
  await fs.rename(path.join(v, 'emblem.svg'), path.join(v, 'Emblem (final).svg'));
  const reqs = await goldRequirements(c, k);
  const run = await runWith(c, reqs);
  const same = outcomes(run, c, k, reqs) === outcomes(baseline[id].run, cases[id], k, baseline[id].reqs);
  const emblem = boundaryFailed(run, 'Deliverables (client)/vector/Emblem (final).svg');
  const badgeFail = boundaryFailed(run, 'Deliverables (client)/vector/badge.svg');
  record('t1-rename-and-update-refs (c3)', same && emblem && !badgeFail && run.readiness.label === baseline[id].run.readiness.label, `per-line outcomes same: ${same}; renamed emblem still fails: ${emblem}; badge fails: ${badgeFail}; readiness ${run.readiness.label}`);
});

await guardBase('t2-reorder-brief (c1)', async () => {
  const id = 'c1-brand-kit';
  const c = await copyCase(cases[id], 't2');
  const f = path.join(c.root, c.briefs[0]);
  const lines = (await fs.readFile(f, 'utf8')).split('\n');
  const bullets = lines.filter((l) => l.startsWith('- ')).reverse();
  let i = 0;
  await fs.writeFile(f, lines.map((l) => (l.startsWith('- ') ? bullets[i++] : l)).join('\n'));
  const a = (await proposeRequirements(adapterOf(cases[id]), c.briefs, [], {})).requirements;
  const b = (await proposeRequirements(adapterOf(c), c.briefs, [], {})).requirements;
  const set = (rs: Requirement[]) => rs.map((r) => `${r.text}|${r.applicability}|${r.predicate.type}`).sort().join('\n');
  const run = await runWith(c, b);
  record('t2-reorder-brief (c1)', set(a) === set(b) && run.readiness.label === e2e[id].readiness.label, `same extracted set: ${set(a) === set(b)}; readiness ${e2e[id].readiness.label} → ${run.readiness.label}`);
});

const paraphrased: { c?: EvalCase } = {};
await guardBase('t3-paraphrase-requirement (c2)', async () => {
  const id = 'c2-missing-variant';
  const c = (paraphrased.c = await copyCase(cases[id], 't3'));
  const f = path.join(c.root, 'brief.txt');
  await fs.writeFile(f, (await fs.readFile(f, 'utf8')).replace('2. wordmark_mono.svg (single-colour version) is required as well.', "2. Don't forget the single-colour one, wordmark_mono.svg."));
  const reqs = (await proposeRequirements(adapterOf(c), c.briefs, [], {})).requirements;
  const has = reqs.some((r) => /wordmark_mono\.svg/.test(r.text));
  const run = await runWith(c, reqs);
  record('t3-paraphrase-requirement (c2)', has && run.readiness.label === 'Fix before sending', `fixed rules still found the mono wordmark promise: ${has}; readiness ${run.readiness.label}`);
});

await guardBase('t4-add-unrelated-files (c2)', async () => {
  const id = 'c2-missing-variant';
  const k = key.cases[id];
  const c = await copyCase(cases[id], 't4');
  await put(c.root, 'handoff/_notes/todo.txt', 'call printer\n');
  await put(c.root, 'handoff/.DS_Store', Buffer.from([0, 0, 0, 1, 66, 117, 100, 49]));
  await put(c.root, 'invoices/inv-001.pdf', '%PDF-1.4\n%%EOF\n');
  await put(c.root, 'wip/sketch.png', makeJpeg(10, 10));
  const reqs = await goldRequirements(c, k);
  const run = await runWith(c, reqs);
  const same = outcomes(run, c, k, reqs) === outcomes(baseline[id].run, cases[id], k, baseline[id].reqs);
  record('t4-add-unrelated-files (c2)', same && run.readiness.label === baseline[id].run.readiness.label, `per-line outcomes same: ${same}; readiness ${baseline[id].run.readiness.label} → ${run.readiness.label}`);
});

await guardBase('t5a-move-dependency-inside (c3)', async () => {
  const id = 'c3-svg-omitted-asset';
  const k = key.cases[id];
  const c = await copyCase(cases[id], 't5a');
  const v = path.join(c.root, 'Deliverables (client)/vector');
  await fs.rename(path.join(c.root, 'assets/grain texture.png'), path.join(v, 'grain texture.png'));
  await fs.writeFile(path.join(v, 'emblem.svg'), (await fs.readFile(path.join(v, 'emblem.svg'), 'utf8')).replace('../../assets/grain%20texture.png', 'grain%20texture.png'));
  const reqs = await goldRequirements(c, k);
  const run = await runWith(c, reqs);
  const emblem = boundaryFailed(run, 'Deliverables (client)/vector/emblem.svg');
  const badge = boundaryFailed(run, 'Deliverables (client)/vector/badge.svg');
  record('t5a-move-dependency-inside (c3)', !emblem && !badge && run.readiness.label === READY, `emblem fails: ${emblem}; badge fails: ${badge}; readiness ${run.readiness.label}`);
});

await guardBase('t5b-move-dependency-outside (c3)', async () => {
  const id = 'c3-svg-omitted-asset';
  const k = key.cases[id];
  const c = await copyCase(cases[id], 't5b');
  const v = path.join(c.root, 'Deliverables (client)/vector');
  await fs.rename(path.join(v, 'textures/weave.png'), path.join(c.root, 'assets/weave.png'));
  await fs.writeFile(path.join(v, 'badge.svg'), (await fs.readFile(path.join(v, 'badge.svg'), 'utf8')).replace('textures/weave.png', '../../assets/weave.png'));
  const run = await runWith(c, await goldRequirements(c, k));
  const emblem = boundaryFailed(run, 'Deliverables (client)/vector/emblem.svg');
  const badge = boundaryFailed(run, 'Deliverables (client)/vector/badge.svg');
  record('t5b-move-dependency-outside (c3)', emblem && badge, `emblem fails: ${emblem}; badge now fails: ${badge}`);
});

await guardBase('t6-change-verified-artifact (c4)', async () => {
  const id = 'c4-misleading-name';
  const k = key.cases[id];
  const c = await copyCase(cases[id], 't6');
  const reqs = await goldRequirements(c, k);
  const before = await runWith(c, reqs);
  await new Promise((r) => setTimeout(r, 15));
  await fs.writeFile(path.join(c.root, 'out/square-post.jpg'), makeJpeg(1080, 1000));
  const fresh = await assessFreshness(before, adapterOf(c));
  const after = await runWith(c, reqs);
  const sq = (r: Run) => goldOutcome(r, c, k.gold[1], reqs).observed;
  const th = (r: Run) => goldOutcome(r, c, k.gold[2], reqs).observed;
  record('t6-change-verified-artifact (c4)', sq(before) === 'verified' && !fresh.current && sq(after) === 'failed' && th(after) === th(before), `square post ${sq(before)} → ${sq(after)}; earlier run reported current: ${fresh.current}; thumbnail ${th(before)} → ${th(after)}`);
});

await guardBase('t7-add-missing-artifact (c2)', async () => {
  const id = 'c2-missing-variant';
  const k = key.cases[id];
  const c = await copyCase(cases[id], 't7');
  const reqs = await goldRequirements(c, k);
  const before = await runWith(c, reqs);
  await fs.copyFile(path.join(c.root, 'wip/wordmark_mono.svg'), path.join(c.root, 'handoff/wordmark_mono.svg'));
  const after = await runWith(c, reqs);
  const o = (r: Run, i: number) => goldOutcome(r, c, k.gold[i], reqs).observed;
  const d = diffRuns(before, after);
  record('t7-add-missing-artifact (c2)', o(after, 1) === 'verified' && o(after, 0) === o(before, 0) && o(after, 2) === o(before, 2) && after.readiness.label === READY, `mono ${o(before, 1)} → ${o(after, 1)}; primary ${o(before, 0)} → ${o(after, 0)}; notes ${o(before, 2)} → ${o(after, 2)}; readiness ${after.readiness.label}; diff resolved ${d.resolved.length}, introduced ${d.introduced.length}`);
});

await guardBase('t8-interrupt-run (c1)', async () => {
  const id = 'c1-brand-kit';
  const ctrl = new AbortController();
  const run = await runWith(cases[id], baseline[id].reqs, {}, { signal: ctrl.signal, onProgress: (e) => e.phase === 'checking' && ctrl.abort() });
  record('t8-interrupt-run (c1)', run.state === 'cancelled' && run.readiness.label !== READY, `state ${run.state}; readiness ${run.readiness.label}`);
});

await guardBase('t9a-symlink-in-delivery (c1)', async () => {
  const id = 'c1-brand-kit';
  const c = await copyCase(cases[id], 't9a');
  await fs.symlink(path.join(c.root, 'Working'), path.join(c.root, 'Final Export/linked-working'));
  const run = await runWith(c, await goldRequirements(c, key.cases[id]));
  record('t9a-symlink-in-delivery (c1)', run.readiness.label !== READY, `readiness ${run.readiness.label}`);
});

await guardBase('t9b-brief-removed (c1)', async () => {
  const id = 'c1-brand-kit';
  const c = await copyCase(cases[id], 't9b');
  const reqs = await goldRequirements(c, key.cases[id]);
  await fs.rm(path.join(c.root, c.briefs[0]));
  const run = await runWith(c, reqs);
  record('t9b-brief-removed (c1)', run.readiness.label !== READY, `readiness ${run.readiness.label}`);
});

await guardBase('t9c-zero-requirements (c8)', async () => {
  const run = await runWith(cases['c8-optional'], []);
  record('t9c-zero-requirements (c8)', run.readiness.label !== READY, `readiness ${run.readiness.label}`);
});

await guardBase('t10-recheck-keeps-confirmed-set (c8)', async () => {
  const id = 'c8-optional';
  const c = await copyCase(cases[id], 't10');
  const reqs = (await goldRequirements(c, key.cases[id])).map((r) => (/favicon/.test(r.text) ? { ...r, enabled: false } : r));
  const before = await runWith(c, reqs);
  await put(c.root, 'Für den Kunden/read me first.txt', 'hello\n');
  const after = await runWith(c, reqs);
  const ids = (r: Run) => r.requirements.map((x) => `${x.id}:${x.enabled}`).join(',');
  const fav = after.requirements.find((r) => /favicon/.test(r.text));
  const favChecked = after.checks.some((x) => x.requirementId === fav?.id);
  const d = diffRuns(before, after);
  record('t10-recheck-keeps-confirmed-set (c8)', ids(before) === ids(after) && fav?.enabled === false && !favChecked && d.introduced.length === 0, `ids and ticks identical: ${ids(before) === ids(after)}; favicon still unticked: ${fav?.enabled === false}; favicon checked anyway: ${favChecked}; newly introduced findings: ${d.introduced.length}`);
});

// AI on the paraphrased brief (t3), to compare with the fixed rules on the same change.
if (AI && paraphrased.c) {
  const k = structuredClone(key.cases['c2-missing-variant']);
  k.gold[1].line = "Don't forget the single-colour one, wordmark_mono.svg.";
  for (const m of ['rules', 'model-only'] as const) rowsX.push((await extractEval(paraphrased.c, k, m, 1, 'c2 paraphrased (t3)')).row);
}

// ---------- output ----------

const byType: Record<string, Record<string, number>> = {};
for (const r of rowsV) {
  byType[r.type] ??= { TP: 0, TN: 0, FP: 0, FN: 0, 'wrong-kind': 0, 'n/a': 0 };
  byType[r.type][r.class]++;
}
const out = { ranAt: new Date().toISOString(), ai: AI ? `${modelCfg!.provider}:${modelCfg!.model}` : null, validators: rowsV, validatorsByType: byType, readiness, extraction: rowsX, invariants: inv };
await fs.mkdir('docs/eval', { recursive: true });
const file = `docs/eval/results-${process.env.EVAL_TAG ?? `${HELDOUT ? 'heldout-' : ''}${AI ? 'ai' : 'rules'}`}.json`;
await fs.writeFile(file, JSON.stringify(out, null, 2));

console.log('\n== Validators, given the answer key\'s promises ==');
for (const r of rowsV) console.log(`${r.ok ? 'ok  ' : 'MISS'} ${r.class.padEnd(10)} ${r.case.padEnd(22)} ${r.type.padEnd(18)} exp ${r.expected.padEnd(17)} got ${r.observed.padEnd(18)} ${r.what.slice(0, 50)}${r.note ? `  [${r.note}]` : ''}`);
console.log(byType);
console.log('\n== Readiness ==');
for (const r of readiness) console.log(`${r.ok ? 'ok  ' : 'MISS'} ${r.case.padEnd(22)} ${r.track.padEnd(58)} exp ${r.expected.padEnd(24)} got ${r.observed}`);
console.log('\n== Extraction ==');
for (const r of rowsX) {
  console.log(`${r.case.padEnd(22)} ${r.method.padEnd(10)} #${r.run} found ${r.found}/${r.gold} missed ${r.missed.length} invented ${r.invented.length} opt/req confusion ${r.applicabilityConfusion.length} citations ${r.citationsValid}/${r.citations} discarded ${r.discardedNotInBrief} ${r.ms}ms${r.error ? ` ERROR ${r.error}` : ''}`);
  for (const m of r.missed) console.log(`     missed:   ${m}`);
  for (const m of r.invented) console.log(`     invented: ${m}`);
  for (const m of r.applicabilityConfusion) console.log(`     confused: ${m}`);
  for (const m of r.ambiguous) console.log(`     ambiguous: ${m}`);
}
console.log('\n== Transformations and invariants ==');
for (const r of inv) console.log(`${r.ok ? 'ok  ' : 'MISS'} ${r.id.padEnd(40)} ${r.detail}`);
console.log(`\nWrote ${file}`);
await fs.rm(base, { recursive: true, force: true });
