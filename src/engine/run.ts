// Run orchestration: authorized files -> reproducible, typed checks.
import { randomUUID } from 'node:crypto';
import {
  EXTRACTOR_VERSION,
  SCHEMA_VERSION,
  VALIDATOR_VERSION,
  type Artifact,
  type CheckResult,
  type CoverageGap,
  type Notice,
  type Requirement,
  type Run,
  type RunInput,
} from '../domain/model.ts';
import { reduceReadiness } from '../domain/readiness.ts';
import { isInside, LIMITS, normalizeRel, type FileAdapter } from './adapter.ts';
import { runBoundaryChecks, runRequirementCheck, type CheckContext } from './checks.ts';
import { createHash } from 'node:crypto';
import { ModelError, acceptProposals, askConflicts, askModel, type CallLog, type ConflictSuggestion, type Fetcher, type ModelConfig } from './model.ts';
import { BOUNDARY_REQUIREMENT_ID, LINKS_REQUIREMENT_ID, buildSources, builtInRequirements, extractFromBrief, looksBinary, resolveAuthority, subjectKeyOf, type AuthorityQuestion } from './extract.ts';

export interface ProgressEvent {
  runId: string;
  phase: 'starting' | 'inventory' | 'reading-sources' | 'checking' | 'boundary' | 'consistency' | 'done';
  message: string;
  done?: number;
  total?: number;
  state: Run['state'];
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
  /** Test hook: called after checks, before the consistency re-stat. */
  beforeConsistencyCheck?: () => Promise<void>;
  runId?: string;
}

export interface ExtractOptions {
  /** 'rules' = fixed rules only. 'ai' = fixed rules plus model proposals; a model failure is an error, never a quiet downgrade. */
  mode?: 'rules' | 'ai';
  model?: { cfg: ModelConfig; fetcher?: Fetcher } | null;
  log?: CallLog;
}

/** Reads the selected briefs and proposes requirements. Used before a run so the user can review them. */
export async function proposeRequirements(
  adapter: FileAdapter,
  briefPaths: string[],
  approvalPaths: string[],
  decisions: Record<string, string>,
  opts: ExtractOptions = {},
): Promise<{ requirements: Requirement[]; notices: Notice[]; questions: AuthorityQuestion[]; mode: 'rule-based' | 'model-assisted'; model: ModelUse; sources: { path: string; sha256: string }[] }> {
  const ai = opts.mode === 'ai';
  if (ai && !opts.model) throw new ModelError('not-configured', 'AI-assisted reading was chosen, but no model is set up.');
  const model = ai ? opts.model! : null;
  const use: ModelUse = { configured: !!opts.model, provider: model?.cfg.provider ?? null, name: model?.cfg.model ?? null, used: false, added: 0, alsoFoundByRules: 0, refined: 0, discarded: 0, ms: 0, suggestedConflicts: [] };
  const notices: Notice[] = [];
  const sources: { path: string; sha256: string }[] = [];
  let requirements: Requirement[] = [];
  const t0 = Date.now();
  for (const p of briefPaths.map(normalizeRel)) {
    const raw = await adapter.readText(p);
    if (await tooLarge(adapter, p)) notices.push({ kind: 'info', path: p, message: `${p} is larger than ${Math.round(LIMITS.maxTextBytes / 1_000_000)} MB, so only the first part was read. Promises further down were not seen; add them by hand or split the document.` });
    const unreadable = looksBinary(raw);
    const text = unreadable ? '' : raw;
    if (unreadable) notices.push({ kind: 'info', path: p, message: 'This document is not plain text (it looks like a binary file such as Pages, Word or a design format), so nothing could be read from it. Export it as text or Markdown, or enter the promises by hand.' });
    sources.push({ path: p, sha256: createHash('sha256').update(raw).digest('hex') });
    const res = extractFromBrief(text, { id: p, path: p });
    requirements.push(...res.requirements);
    notices.push(...res.notices);
    if (model && !unreadable) {
      // Errors propagate: the caller chose AI-assisted reading and must be told it did not happen.
      const proposals = await askModel(model.cfg, text, model.fetcher, opts.log);
      const merged = acceptProposals(text, { id: p, path: p }, proposals, res.requirements);
      // Refinements to rule-found promises: only a clearer deliverable name, or required -> conditional/optional when the sentence itself says so.
      for (const f of merged.refinements) {
        const r = requirements.find((x) => x.id === f.id);
        if (!r) continue;
        if (f.applicability) {
          r.applicability = f.applicability;
          if (f.condition) r.condition = f.condition;
        }
        if (f.nameTokens && (r.predicate.type === 'file-included' || r.predicate.type === 'image-dimensions') && !r.predicate.exactName) {
          r.predicate = { ...r.predicate, nameTokens: f.nameTokens };
          r.subjectKey = subjectKeyOf(r.predicate);
        }
        if (f.applicability || f.nameTokens) use.refined++;
      }
      requirements.push(...merged.added);
      notices.push(...merged.notices);
      use.used = true;
      use.added += merged.stats.accepted;
      use.alsoFoundByRules += merged.stats.alreadyFound;
      use.discarded += merged.stats.rejectedNotVerbatim + merged.stats.rejectedInstruction;
    }
  }
  if (model) {
    use.suggestedConflicts = await askConflicts(model.cfg, requirements, model.fetcher, opts.log);
    use.ms = Date.now() - t0;
  }
  const approvalTexts = [];
  for (const p of approvalPaths.map(normalizeRel)) approvalTexts.push({ path: p, text: await adapter.readText(p) });
  const resolved = resolveAuthority(requirements, decisions, approvalTexts);
  requirements = resolved.requirements;
  const briefHasBoundary = requirements.some((r) => r.predicate.type === 'references-resolve');
  const builtIns = builtInRequirements().filter((b) => !(briefHasBoundary && b.id === BOUNDARY_REQUIREMENT_ID));
  // A boundary sentence in the brief is folded into the built-in analysis but keeps the brief's provenance.
  if (briefHasBoundary) {
    const first = requirements.find((r) => r.predicate.type === 'references-resolve')!;
    requirements = requirements.filter((r) => r.predicate.type !== 'references-resolve');
    requirements.push({ ...first, id: BOUNDARY_REQUIREMENT_ID, subjectKey: 'boundary' });
  }
  return { requirements: [...requirements, ...builtIns], notices, questions: resolved.questions, mode: use.used ? 'model-assisted' : 'rule-based', model: use, sources };
}

export interface ModelUse {
  configured: boolean;
  provider: string | null;
  name: string | null;
  used: boolean;
  added: number;
  alsoFoundByRules: number;
  refined: number;
  discarded: number;
  ms: number;
  /** Advisory only: pairs the model thinks disagree. They never change a result; the user decides. */
  suggestedConflicts: ConflictSuggestion[];
}

function emptyRun(adapter: FileAdapter, input: RunInput, id: string): Run {
  const base: Run = {
    id,
    schemaVersion: SCHEMA_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    projectName: input.projectName,
    adapterKind: adapter.kind,
    rootId: adapter.root.id,
    rootLabel: adapter.root.label,
    deliveryPath: '',
    briefPaths: [],
    approvalPaths: [],
    extractionMode: input.extractionMode,
    ...(input.extractionModel ? { extractionModel: input.extractionModel } : {}),
    authorityDecisions: input.authorityDecisions ?? {},
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    sources: [],
    requirements: [],
    artifacts: [],
    dependencies: [],
    checks: [],
    coverage: { inventoryComplete: false, filesInScope: 0, filesInDelivery: 0, gaps: [] },
    notices: [],
    readiness: undefined as never,
  };
  base.readiness = reduceReadiness({ state: 'running', briefCount: 0, requirements: [], checks: [], coverage: base.coverage });
  return base;
}

export async function executeRun(adapter: FileAdapter, input: RunInput, opts: RunOptions = {}): Promise<Run> {
  const id = opts.runId ?? `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`;
  const run = emptyRun(adapter, input, id);
  const emit = (phase: ProgressEvent['phase'], message: string, done?: number, total?: number) =>
    opts.onProgress?.({ runId: id, phase, message, done, total, state: run.state });
  const finish = (state: Run['state'], failure?: string): Run => {
    run.state = state;
    if (failure) run.failure = failure;
    run.finishedAt = new Date().toISOString();
    if (state === 'cancelled') run.coverage.gaps.push({ kind: 'cancelled', reason: 'The check was cancelled; anything not listed was not inspected.' });
    run.readiness = reduceReadiness({ state, failure, briefCount: run.briefPaths.length, requirements: run.requirements, checks: run.checks, coverage: run.coverage });
    emit('done', run.readiness.label);
    return run;
  };

  try {
    run.deliveryPath = normalizeRel(input.deliveryPath);
    run.briefPaths = input.briefPaths.map(normalizeRel);
    run.approvalPaths = input.approvalPaths.map(normalizeRel);
    emit('starting', 'Starting');

    for (let attempt = 1; attempt <= 2; attempt++) {
      run.checks = [];
      run.dependencies = [];
      run.notices = [];
      const gaps: CoverageGap[] = [];

      emit('inventory', 'Listing files');
      const inv = await adapter.inventory(run.deliveryPath, opts.signal, (n) => n % 25 === 0 && emit('inventory', `Listing files (${n})`, n));
      run.artifacts = inv.artifacts;
      gaps.push(...inv.gaps.filter((g) => g.kind !== 'symlink-not-followed' || (g.path && isInside(run.deliveryPath, g.path))));
      run.coverage = {
        inventoryComplete: inv.complete,
        filesInScope: inv.artifacts.length,
        filesInDelivery: inv.artifacts.filter((a) => a.inDelivery).length,
        gaps,
      };
      if (inv.cancelled || opts.signal?.aborted) return finish('cancelled');

      emit('reading-sources', 'Reading the brief');
      const byPath = new Map(run.artifacts.map((a) => [a.path, a]));
      const approvalRecords: { path: string; text: string }[] = [];
      for (const p of run.approvalPaths) {
        try {
          approvalRecords.push({ path: p, text: await adapter.readText(p) });
          if (await tooLarge(adapter, p)) gaps.push({ kind: 'limit-reached', path: p, reason: `This approval record is larger than ${Math.round(LIMITS.maxTextBytes / 1_000_000)} MB, so only the first part was read.` });
        } catch {
          gaps.push({ kind: 'unreadable', path: p, reason: 'This approval record could not be read.' });
        }
      }
      for (const p of run.briefPaths) {
        try {
          // Re-scan sources for instruction-like text so the run records what was ignored.
          const raw = await adapter.readText(p);
          if (await tooLarge(adapter, p)) gaps.push({ kind: 'limit-reached', path: p, reason: `This brief is larger than ${Math.round(LIMITS.maxTextBytes / 1_000_000)} MB, so only the first part was read.` });
          if (looksBinary(raw)) {
            gaps.push({ kind: 'unsupported-format', path: p, reason: 'This brief is not plain text, so it could not be read.' });
            continue;
          }
          const res = extractFromBrief(raw, { id: p, path: p });
          run.notices.push(...res.notices);
        } catch {
          gaps.push({ kind: 'unreadable', path: p, reason: 'This brief could not be read.' });
        }
      }
      const resolved = resolveAuthority(input.requirements, run.authorityDecisions, approvalRecords);
      run.requirements = resolved.requirements;
      for (const q of resolved.questions) run.notices.push({ kind: 'authority-question', message: `${q.question} (${q.options.map((o) => o.sourcePath).join(' vs ')})` });
      run.sources = buildSources(
        run.briefPaths.map((p) => ({ path: p, sha256: byPath.get(p)?.sha256 ?? null })),
        run.approvalPaths.map((p) => ({ path: p, sha256: byPath.get(p)?.sha256 ?? null })),
        resolved.sourceAuthority,
      );

      const ctx: CheckContext = {
        runId: id,
        adapter,
        deliveryPath: run.deliveryPath,
        artifacts: run.artifacts,
        inventoryComplete: inv.complete,
        approvalRecords,
        gaps,
        notices: run.notices,
        demoFixes: adapter.kind === 'synthetic-fixture',
      };
      const toCheck = run.requirements.filter((r) => r.enabled && r.authority !== 'superseded' && r.id !== BOUNDARY_REQUIREMENT_ID && r.id !== LINKS_REQUIREMENT_ID);
      let n = 0;
      for (const r of toCheck) {
        if (opts.signal?.aborted) return finish('cancelled');
        emit('checking', `Checking: ${r.text.slice(0, 80)}`, n, toCheck.length);
        run.checks.push(...(await runRequirementCheck(ctx, r)));
        n++;
        emit('checking', `Checked ${n} of ${toCheck.length}`, n, toCheck.length);
      }
      if (opts.signal?.aborted) return finish('cancelled');
      emit('boundary', 'Working out what your client gets');
      const boundaryOn = run.requirements.some((r) => r.id === BOUNDARY_REQUIREMENT_ID && r.enabled);
      const linksOn = run.requirements.some((r) => r.id === LINKS_REQUIREMENT_ID && r.enabled);
      const b = await runBoundaryChecks(ctx, boundaryOn, linksOn);
      run.checks.push(...b.checks);
      run.dependencies = b.dependencies;
      if (opts.signal?.aborted) return finish('cancelled');

      // Before/after identity check. This is not an atomic snapshot: it detects
      // files that changed while we were reading them.
      emit('consistency', 'Making sure nothing changed while checking');
      if (attempt === 1) await opts.beforeConsistencyCheck?.();
      if (opts.signal?.aborted) return finish('cancelled');
      const changed = await changedSince(adapter, run.artifacts);
      if (opts.signal?.aborted) return finish('cancelled');
      if (changed.length === 0) break;
      if (attempt === 1) {
        emit('consistency', `${changed.length} file(s) changed during the check — checking again`);
        continue;
      }
      for (const p of changed) gaps.push({ kind: 'changed-during-inspection', path: p, reason: 'This file kept changing while it was being checked.' });
      run.checks = run.checks.map((c) =>
        c.relatedPaths.some((p) => changed.includes(p)) || c.inspected.some((i) => changed.includes(i.path))
          ? { ...c, outcome: 'needs-review' as const, observed: `${c.observed} (The file changed while it was being checked, so this observation is not reliable.)` }
          : c,
      );
    }
    return finish('completed');
  } catch (e) {
    return finish('failed', e instanceof Error ? e.message : String(e));
  }
}

/** Text is read up to a fixed size. Anything larger was only partly read, and the run must say so. */
async function tooLarge(adapter: FileAdapter, p: string): Promise<boolean> {
  const s = await adapter.stat(p);
  return !!s && s.size > LIMITS.maxTextBytes;
}

async function changedSince(adapter: FileAdapter, artifacts: Artifact[]): Promise<string[]> {
  const changed: string[] = [];
  for (const a of artifacts) {
    const s = await adapter.stat(a.path);
    if (!s || s.size !== a.size || s.mtimeMs !== a.mtimeMs) changed.push(a.path);
  }
  return changed;
}

export type { CheckResult };
