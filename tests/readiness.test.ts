import { describe, expect, it } from 'vitest';
import type { CheckOutcome, CheckResult, Coverage, Requirement } from '../src/domain/model.ts';
import { reduceReadiness } from '../src/domain/readiness.ts';

const cov = (over: Partial<Coverage> = {}): Coverage => ({ inventoryComplete: true, filesInScope: 3, filesInDelivery: 2, gaps: [], ...over });
const req = (id: string, over: Partial<Requirement> = {}): Requirement => ({
  id, text: id, sourceId: 'b', sourcePath: 'brief.md', excerpt: id, location: { line: 1 },
  predicate: { type: 'file-included', exactName: `${id}.svg`, nameTokens: [], extensions: [] },
  applicability: 'required', authority: 'authoritative', origin: 'rule-based', subjectKey: id, enabled: true, ...over,
});
const chk = (requirementId: string, outcome: CheckOutcome, n = 0): CheckResult => ({
  id: `${requirementId}::${n}`, runId: 'r', requirementId, title: '', outcome, method: '', observed: '', why: '', evidence: [], inspected: [], limitations: [],
  repair: { kind: 'none', action: '' }, relatedPaths: [],
});
const reduce = (requirements: Requirement[], checks: CheckResult[], over: Partial<Parameters<typeof reduceReadiness>[0]> = {}) =>
  reduceReadiness({ state: 'completed', briefCount: 1, requirements, checks, coverage: cov(), ...over });

describe('readiness reducer', () => {
  it('all required verified with full coverage is the only green state', () => {
    const r = reduce([req('a'), req('b')], [chk('a', 'verified'), chk('b', 'verified')]);
    expect(r.display).toBe('ready-on-checked-items');
    expect(r.counts).toMatchObject({ requiredRequirements: 2, verified: 2, blocking: 0, unresolved: 0 });
  });
  it('mixed failures and unknowns: failure wins, unknowns still counted', () => {
    const r = reduce([req('a'), req('b'), req('c'), req('d')], [chk('a', 'failed'), chk('b', 'needs-review'), chk('c', 'verified'), chk('d', 'unable-to-inspect')]);
    expect(r.display).toBe('fix-before-sending');
    expect(r.counts).toMatchObject({ blocking: 1, unresolved: 2, verified: 1 });
  });
  it('not-found-in-scope on a required item blocks', () => {
    expect(reduce([req('a')], [chk('a', 'not-found-in-scope')]).display).toBe('fix-before-sending');
  });
  it('zero requirements is never green', () => {
    expect(reduce([], []).display).toBe('could-not-complete');
  });
  it('no brief is never green even if checks pass', () => {
    expect(reduce([req('a')], [chk('a', 'verified')], { briefCount: 0 }).display).toBe('could-not-complete');
  });
  it('partial scan is never green', () => {
    expect(reduce([req('a')], [chk('a', 'verified')], { coverage: cov({ inventoryComplete: false }) }).display).toBe('needs-your-review');
  });
  it('a coverage gap is never green', () => {
    expect(reduce([req('a')], [chk('a', 'verified')], { coverage: cov({ gaps: [{ kind: 'unsupported-format', path: 'x.psd', reason: 'x' }] }) }).display).toBe('needs-your-review');
  });
  it('a required item with no check is unresolved, not verified', () => {
    const r = reduce([req('a'), req('b')], [chk('a', 'verified')]);
    expect(r.display).toBe('needs-your-review');
    expect(r.counts.unresolved).toBe(1);
  });
  it.each(['needs-review', 'unable-to-inspect', 'scope-conflict', 'stale'] as CheckOutcome[])('%s on a required item prevents green', (o) => {
    expect(reduce([req('a')], [chk('a', o)]).display).toBe('needs-your-review');
  });
  it('conflicting scope stays unresolved even if a check passed', () => {
    const r = reduce([req('a', { authority: 'conflicting' })], [chk('a', 'verified')]);
    expect(r.display).toBe('needs-your-review');
    expect(r.perRequirement[0].outcome).toBe('scope-conflict');
  });
  it('several candidate checks for one requirement are counted once', () => {
    const r = reduce([req('a')], [chk('a', 'failed', 1), chk('a', 'failed', 2), chk('a', 'verified', 3)]);
    expect(r.counts).toMatchObject({ requiredRequirements: 1, blocking: 1, verified: 0 });
  });
  it('optional and suggested items never become required', () => {
    const r = reduce([req('a'), req('o', { applicability: 'optional' }), req('s', { applicability: 'suggestion' })], [chk('a', 'verified'), chk('o', 'not-found-in-scope'), chk('s', 'needs-review')]);
    expect(r.display).toBe('ready-on-checked-items');
    expect(r.counts).toMatchObject({ requiredRequirements: 1, optionalOpen: 2 });
  });
  it('an unresolved condition cannot be verified; a dismissed one does not count', () => {
    const c = req('c', { applicability: 'conditional', condition: 'if print' });
    expect(reduce([c], [chk('c', 'verified')]).display).toBe('needs-your-review');
    expect(reduce([req('a'), { ...c, conditionResolved: 'does-not-apply' }], [chk('a', 'verified'), chk('c', 'failed')]).display).toBe('ready-on-checked-items');
    expect(reduce([{ ...c, conditionResolved: 'applies' }], [chk('c', 'verified')]).display).toBe('ready-on-checked-items');
  });
  it('execution failure and cancellation are "could not complete", whatever the checks say', () => {
    expect(reduce([req('a')], [chk('a', 'verified')], { state: 'failed', failure: 'boom' }).display).toBe('could-not-complete');
    expect(reduce([req('a')], [chk('a', 'verified')], { state: 'cancelled' }).display).toBe('could-not-complete');
    expect(reduce([req('a')], [chk('a', 'verified')], { state: 'running' }).display).toBe('could-not-complete');
  });
  it('superseded and disabled requirements are excluded', () => {
    const r = reduce([req('a'), req('b', { authority: 'superseded' }), req('c', { enabled: false })], [chk('a', 'verified'), chk('b', 'failed'), chk('c', 'failed')]);
    expect(r.display).toBe('ready-on-checked-items');
    expect(r.counts.requiredRequirements).toBe(1);
  });
  it('is deterministic and carries no percentages', () => {
    const args: [Requirement[], CheckResult[]] = [[req('a'), req('b')], [chk('a', 'failed'), chk('b', 'verified')]];
    expect(reduce(...args)).toEqual(reduce(...args));
    expect(JSON.stringify(reduce(...args))).not.toMatch(/%|confidence|score/i);
  });
});
