import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AdapterKind, Requirement, Run } from '../../src/domain/model.ts';
import { LocalFsAdapter } from '../../src/engine/adapter.ts';
import { executeRun, proposeRequirements, type RunOptions } from '../../src/engine/run.ts';

export async function tmpRoot(prefix = 'loose-ends-'): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}
export function adapterFor(absPath: string, kind: AdapterKind = 'synthetic-fixture') {
  return new LocalFsAdapter({ id: 't', label: 'test', kind, absPath });
}
export interface Scenario {
  root: string;
  delivery: string;
  briefs: string[];
  approvals?: string[];
  project?: string;
  decisions?: Record<string, string>;
  kind?: AdapterKind;
  edit?: (reqs: Requirement[]) => Requirement[];
}
export async function check(s: Scenario, opts: RunOptions = {}): Promise<Run> {
  const adapter = adapterFor(s.root, s.kind);
  const proposed = await proposeRequirements(adapter, s.briefs, s.approvals ?? [], s.decisions ?? {});
  const requirements = s.edit ? s.edit(proposed.requirements) : proposed.requirements;
  return executeRun(
    adapter,
    { projectName: s.project ?? 'Test', rootId: 't', deliveryPath: s.delivery, briefPaths: s.briefs, approvalPaths: s.approvals ?? [], requirements, extractionMode: 'rule-based', authorityDecisions: s.decisions ?? {} },
    opts,
  );
}
/** Findings reduced to name-independent facts, for comparing runs across renamed fixtures. */
export function shape(run: Run) {
  return {
    display: run.readiness.display,
    counts: run.readiness.counts,
    open: run.checks
      .filter((c) => c.outcome !== 'verified')
      .map((c) => `${run.requirements.find((r) => r.id === c.requirementId)?.predicate.type}:${c.outcome}:${c.repair.kind}`)
      .sort(),
    verified: run.checks.filter((c) => c.outcome === 'verified').length,
    deps: run.dependencies.map((d) => `${d.referenceType}:${d.availability}:${d.essential}`).sort(),
  };
}
