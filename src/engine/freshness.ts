// Evidence invalidation and run diffs. Historical runs are never modified:
// staleness is a derived view of "this run, compared with the files right now".
import { EXTRACTOR_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, type CheckResult, type DiffEntry, type Readiness, type Run, type RunDiff } from '../domain/model.ts';
import { reduceReadiness } from '../domain/readiness.ts';
import type { FileAdapter } from './adapter.ts';
import { candidates, partialCandidate } from './checks.ts';
import { BOUNDARY_REQUIREMENT_ID } from './extract.ts';

export interface Freshness {
  runId: string;
  comparedAt: string;
  current: boolean;
  everythingStale: boolean;
  reasons: string[];
  changedPaths: string[];
  removedPaths: string[];
  addedPaths: string[];
  staleCheckIds: string[];
  checks: CheckResult[]; // the run's checks with affected ones shown as stale
  readiness: Readiness;
}

export interface FreshnessOverrides {
  deliveryPath?: string;
  requirementIds?: string[];
}

/** Compares a finished run with the files as they are now. Full re-inventory: simple and correct for this MVP. */
export async function assessFreshness(run: Run, adapter: FileAdapter, overrides: FreshnessOverrides = {}): Promise<Freshness> {
  const reasons: string[] = [];
  let everythingStale = false;
  if (run.schemaVersion !== SCHEMA_VERSION || run.validatorVersion !== VALIDATOR_VERSION || run.extractorVersion !== EXTRACTOR_VERSION) {
    everythingStale = true;
    reasons.push('Loose Ends’ checks have been updated since this run.');
  }
  if (overrides.deliveryPath !== undefined && overrides.deliveryPath !== run.deliveryPath) {
    everythingStale = true;
    reasons.push('The folder you’re sending has changed. Every result depends on it.');
  }
  if (overrides.requirementIds) {
    const before = run.requirements.filter((r) => r.enabled).map((r) => r.id).sort().join(',');
    const after = [...overrides.requirementIds].sort().join(',');
    if (before !== after) {
      everythingStale = true;
      reasons.push('The list of promises being checked has changed.');
    }
  }

  // Files whose size and modified time are unchanged keep the fingerprint recorded by the run, so polling does not
  // re-read a whole project folder every few seconds. A real check always fingerprints from scratch.
  const inv = await adapter.inventory(run.deliveryPath, undefined, undefined, new Map(run.artifacts.map((a) => [a.path, a])));
  const now = new Map(inv.artifacts.map((a) => [a.path, a]));
  const then = new Map(run.artifacts.map((a) => [a.path, a]));
  const changedPaths: string[] = [];
  const removedPaths: string[] = [];
  const addedPaths: string[] = [];
  for (const [p, a] of then) {
    const cur = now.get(p);
    if (!cur) removedPaths.push(p);
    else if (a.sha256 && cur.sha256 ? a.sha256 !== cur.sha256 : a.size !== cur.size || a.mtimeMs !== cur.mtimeMs) changedPaths.push(p);
  }
  for (const p of now.keys()) if (!then.has(p)) addedPaths.push(p);
  const touched = new Set([...changedPaths, ...removedPaths]);

  const sourceChanged = [...run.briefPaths, ...run.approvalPaths].filter((p) => touched.has(p));
  if (sourceChanged.some((p) => run.briefPaths.includes(p))) {
    everythingStale = true;
    reasons.push(`The brief changed (${sourceChanged.join(', ')}), so the promises may have changed.`);
  }

  const reqById = new Map(run.requirements.map((r) => [r.id, r]));
  const addedInDelivery = inv.artifacts.filter((a) => addedPaths.includes(a.path) && a.inDelivery);
  const addedArtifacts = inv.artifacts.filter((a) => addedPaths.includes(a.path));
  const staleCheckIds: string[] = [];
  const checks = run.checks.map((c): CheckResult => {
    let stale = everythingStale;
    let why = '';
    if (!stale && (c.relatedPaths.some((p) => touched.has(p)) || c.inspected.some((i) => touched.has(i.path)))) {
      stale = true;
      why = 'A file this result relied on has changed.';
    }
    if (!stale) {
      const r = reqById.get(c.requirementId);
      const p = r?.predicate;
      // New candidate files can overturn an earlier "not found" or change which file a check applies to.
      const names = p && p.type === 'file-included' && p.exactNames?.length ? p.exactNames : null;
      const couldMatch =
        p && (p.type === 'file-included' || p.type === 'image-dimensions')
          ? names
            ? names.some((n) => candidates({ exactName: n }, addedArtifacts).length > 0)
            : candidates(p, addedArtifacts).length > 0 || partialCandidate(p, addedArtifacts) !== null
          : false;
      if (couldMatch) {
        stale = true;
        why = 'A new file that could satisfy this promise has appeared.';
      } else if (p?.type === 'approved-version' && candidates({ subjectTokens: p.subjectTokens, exactName: p.exactName }, addedArtifacts).length > 0) {
        stale = true;
        why = 'A new version of this document has appeared.';
      } else if (c.requirementId === BOUNDARY_REQUIREMENT_ID && c.id.endsWith('::self-contained') && addedInDelivery.length > 0) {
        stale = true;
        why = 'New files were added to the delivery and have not been inspected.';
      }
    }
    if (!stale) return c;
    staleCheckIds.push(c.id);
    return { ...c, outcome: 'stale', observed: `${why || reasons[0] || 'Inputs changed.'} Last observed: ${c.observed}` };
  });
  // New delivered files that nothing has looked at make the boundary result incomplete.
  if (!everythingStale && addedInDelivery.length > 0 && !checks.some((c) => c.requirementId === BOUNDARY_REQUIREMENT_ID && c.outcome === 'stale')) {
    const first = checks.findIndex((c) => c.requirementId === BOUNDARY_REQUIREMENT_ID);
    if (first >= 0) {
      staleCheckIds.push(checks[first].id);
      checks[first] = { ...checks[first], outcome: 'stale', observed: `New files were added to the delivery and have not been inspected. Last observed: ${checks[first].observed}` };
    }
  }
  if (changedPaths.length) reasons.push(`${changedPaths.length} file(s) changed since this check.`);
  if (removedPaths.length) reasons.push(`${removedPaths.length} file(s) were removed since this check.`);
  if (addedPaths.length) reasons.push(`${addedPaths.length} new file(s) appeared since this check.`);

  const readiness = reduceReadiness({ state: run.state, failure: run.failure, briefCount: run.briefPaths.length, requirements: run.requirements, checks, coverage: run.coverage });
  return {
    runId: run.id,
    comparedAt: new Date().toISOString(),
    current: staleCheckIds.length === 0,
    everythingStale,
    reasons,
    changedPaths,
    removedPaths,
    addedPaths,
    staleCheckIds,
    checks,
    readiness,
  };
}

const OPEN = new Set(['failed', 'not-found-in-scope', 'needs-review', 'unable-to-inspect', 'scope-conflict', 'stale']);

/**
 * Finding-level diff between two immutable runs. Checks are matched by a key
 * that survives a fix (requirement + inspected subject), so "resolved" means the
 * new run actually observed a passing result.
 */
export function diffRuns(previous: Run, current: Run): RunDiff {
  const key = (c: CheckResult) => `${c.requirementId}|${subjectOf(c)}`;
  const prev = new Map(previous.checks.map((c) => [key(c), c]));
  const cur = new Map(current.checks.map((c) => [key(c), c]));
  const resolved: DiffEntry[] = [];
  const stillOpen: DiffEntry[] = [];
  const introduced: DiffEntry[] = [];
  const newlyUnresolved: DiffEntry[] = [];
  let unchangedVerified = 0;
  const curReqOpen = new Map<string, boolean>();
  for (const c of current.checks) curReqOpen.set(c.requirementId + '|' + sourceOf(c), (curReqOpen.get(c.requirementId + '|' + sourceOf(c)) ?? false) || OPEN.has(c.outcome));

  for (const [k, p] of prev) {
    const c = cur.get(k);
    if (OPEN.has(p.outcome)) {
      if (c && OPEN.has(c.outcome)) stillOpen.push({ checkId: c.id, title: c.title, before: p.outcome, after: c.outcome, explanation: 'Still open after the recheck.' });
      else if (c) resolved.push({ checkId: c.id, title: p.title, before: p.outcome, after: c.outcome, explanation: `Now observed: ${c.observed}` });
      else {
        // The old finding has no direct counterpart. It is resolved only if the same requirement/file has no open check now.
        const open = curReqOpen.get(p.requirementId + '|' + sourceOf(p));
        if (open === false) resolved.push({ checkId: p.id, title: p.title, before: p.outcome, after: 'verified', explanation: 'The recheck inspected the same file and no longer finds this problem.' });
        else if (open === undefined) resolved.push({ checkId: p.id, title: p.title, before: p.outcome, after: null, explanation: 'This item is no longer part of the check (the file or the promise is gone).' });
      }
    } else if (c) {
      if (OPEN.has(c.outcome)) newlyUnresolved.push({ checkId: c.id, title: c.title, before: p.outcome, after: c.outcome, explanation: `Previously passed. Now: ${c.observed}` });
      else unchangedVerified++;
    }
  }
  for (const [k, c] of cur) {
    if (prev.has(k) || !OPEN.has(c.outcome)) continue;
    const hadSame = previous.checks.some((p) => p.requirementId === c.requirementId && sourceOf(p) === sourceOf(c));
    const entry = { checkId: c.id, title: c.title, before: null, after: c.outcome, explanation: `New in this run: ${c.observed}` };
    if (hadSame && previous.checks.some((p) => p.requirementId === c.requirementId && sourceOf(p) === sourceOf(c) && !OPEN.has(p.outcome))) newlyUnresolved.push(entry);
    else introduced.push(entry);
  }
  const parts: string[] = [];
  const n = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;
  parts.push(`${n(resolved.length, 'issue')} resolved.`);
  if (stillOpen.length) parts.push(`${stillOpen.length} still ${stillOpen.length === 1 ? 'needs' : 'need'} attention.`);
  if (introduced.length + newlyUnresolved.length) parts.push(`${n(introduced.length + newlyUnresolved.length, 'new issue')} found.`);
  return { previousRunId: previous.id, currentRunId: current.id, resolved, stillOpen, introduced, newlyUnresolved, unchangedVerified, summary: parts.join(' ') };
}

function subjectOf(c: CheckResult): string {
  return c.id.slice(c.requirementId.length + 2);
}
/** For boundary checks, the file that was inspected; otherwise the requirement itself. */
function sourceOf(c: CheckResult): string {
  return c.requirementId === BOUNDARY_REQUIREMENT_ID ? (c.inspected[0]?.path ?? subjectOf(c)) : '';
}
