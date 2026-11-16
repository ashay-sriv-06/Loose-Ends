import {
  BLOCKING_OUTCOMES,
  READINESS_LABEL,
  type CheckOutcome,
  type CheckResult,
  type Coverage,
  type Readiness,
  type ReadinessDisplay,
  type Requirement,
  type RequirementStatus,
  type RunState,
} from './model.ts';

export interface ReadinessInput {
  state: RunState;
  failure?: string;
  briefCount: number;
  requirements: Requirement[];
  checks: CheckResult[];
  coverage: Coverage;
}

/** Severity order used to fold several checks of one requirement into one status. */
const ORDER: (CheckOutcome | 'no-check')[] = [
  'failed',
  'not-found-in-scope',
  'scope-conflict',
  'unable-to-inspect',
  'stale',
  'needs-review',
  'no-check',
  'verified',
];

export function foldOutcomes(outcomes: CheckOutcome[]): CheckOutcome | 'no-check' {
  if (outcomes.length === 0) return 'no-check';
  let best: CheckOutcome | 'no-check' = 'verified';
  for (const o of outcomes) if (ORDER.indexOf(o) < ORDER.indexOf(best)) best = o;
  return best;
}

/** A requirement counts toward readiness when it is required, or conditional and confirmed to apply. */
export function isBinding(r: Requirement): boolean {
  if (!r.enabled) return false;
  if (r.authority === 'superseded') return false;
  if (r.applicability === 'required') return true;
  if (r.applicability === 'conditional') return r.conditionResolved !== 'does-not-apply';
  return false;
}

/**
 * Deterministic readiness reducer. Every count derives from check records;
 * a requirement with several candidate files is counted once.
 */
export function reduceReadiness(input: ReadinessInput): Readiness {
  const active = input.requirements.filter((r) => r.enabled && r.authority !== 'superseded');
  const byReq = new Map<string, CheckOutcome[]>();
  for (const c of input.checks) {
    const list = byReq.get(c.requirementId) ?? [];
    list.push(c.outcome);
    byReq.set(c.requirementId, list);
  }

  const perRequirement: RequirementStatus[] = active.map((r) => {
    let outcome = foldOutcomes(byReq.get(r.id) ?? []);
    // An unresolved condition can never count as verified.
    if (r.applicability === 'conditional' && !r.conditionResolved && outcome === 'verified') outcome = 'needs-review';
    if (r.authority === 'conflicting' && (outcome === 'verified' || outcome === 'no-check')) outcome = 'scope-conflict';
    return { requirementId: r.id, outcome };
  });
  const statusOf = new Map(perRequirement.map((s) => [s.requirementId, s.outcome]));

  const binding = active.filter(isBinding);
  const optional = active.filter((r) => !isBinding(r));
  let blocking = 0;
  let unresolved = 0;
  let verified = 0;
  for (const r of binding) {
    const o = statusOf.get(r.id)!;
    if (o !== 'no-check' && BLOCKING_OUTCOMES.includes(o)) blocking++;
    else if (o === 'verified') verified++;
    else unresolved++;
  }
  const optionalOpen = optional.filter((r) => !['verified', 'no-check'].includes(statusOf.get(r.id)!)).length;
  const counts = { requiredRequirements: binding.length, blocking, unresolved, verified, optionalOpen };

  // Promises that came from a document, a person or a model suggestion — not the product's own built-in checks.
  const fromSources = active.filter((r) => r.origin !== 'built-in').length;

  const reasons: string[] = [];
  let display: ReadinessDisplay;

  if (input.state === 'failed' || input.state === 'cancelled' || input.state === 'queued' || input.state === 'running') {
    display = 'could-not-complete';
    reasons.push(
      input.state === 'failed'
        ? `The check stopped with an error${input.failure ? `: ${input.failure}` : ''}.`
        : input.state === 'cancelled'
          ? 'The check was cancelled before it finished. Results so far are partial.'
          : 'The check has not finished.',
    );
  } else if (blocking === 0 && (input.briefCount === 0 || fromSources === 0)) {
    // Nothing to check the folder against. Built-in checks alone can never stand in for what was promised.
    display = 'could-not-complete';
    reasons.push(input.briefCount === 0 ? 'No brief was provided, so there is nothing to check the folder against.' : 'No promises were read from the brief, so there is nothing to check the folder against.');
    if (input.coverage.gaps.length > 0) reasons.push(`${input.coverage.gaps.length} ${plural(input.coverage.gaps.length, 'file or reference')} could not be fully inspected.`);
  } else if (blocking > 0) {
    display = 'fix-before-sending';
    reasons.push(blocking === 1 ? '1 required item failed its check.' : `${blocking} required items failed their checks.`);
    if (unresolved > 0) reasons.push(`${unresolved} more required ${plural(unresolved, 'item')} could not be settled.`);
  } else {
    // No known required failure. Green only with full required coverage.
    const blockers: string[] = [];
    if (input.briefCount === 0) blockers.push('No brief was provided, so there is nothing to check the folder against.');
    if (binding.length === 0) blockers.push('No required commitments were found in the brief.');
    if (unresolved > 0) blockers.push(`${unresolved} required ${plural(unresolved, 'item')} could not be settled.`);
    if (!input.coverage.inventoryComplete) blockers.push('The folder scan was incomplete.');
    if (input.coverage.gaps.length > 0)
      blockers.push(`${input.coverage.gaps.length} ${plural(input.coverage.gaps.length, 'file or reference')} could not be fully inspected.`);
    if (blockers.length > 0) {
      display = 'needs-your-review';
      reasons.push(...blockers);
    } else {
      display = 'ready-on-checked-items';
      reasons.push(`All ${verified} required ${plural(verified, 'item')} passed. This covers only what was checked.`);
    }
  }
  if (optionalOpen > 0) reasons.push(`${optionalOpen} optional ${plural(optionalOpen, 'item')} not confirmed (does not block sending).`);

  return { display, label: READINESS_LABEL[display], reasons, counts, perRequirement };
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
