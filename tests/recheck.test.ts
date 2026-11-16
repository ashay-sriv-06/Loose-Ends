import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Run } from '../src/domain/model.ts';
import { applyDemoOperations } from '../src/engine/demo.ts';
import { assessFreshness, diffRuns } from '../src/engine/freshness.ts';
import { parseApprovalRecord } from '../src/engine/checks.ts';
import { ACME, buildAcme } from '../src/fixture/build.ts';
import { adapterFor, check, tmpRoot } from './helpers/harness.ts';

let root: string;
const scenario = () => ({ root, delivery: 'Delivery', briefs: ['Brief/brief.md'], approvals: ['Approvals/approval-note.md'] });
const applyFix = async (run: Run, match: string) => {
  const c = run.checks.find((x) => x.title.includes(match) && x.repair.demoFix)!;
  return applyDemoOperations({ id: 't', label: 't', kind: 'synthetic-fixture', absPath: root }, c.repair.demoFix!.operations);
};
beforeEach(async () => {
  root = await tmpRoot();
  await buildAcme(root);
});

describe('evidence invalidation', () => {
  it('an untouched run is current', async () => {
    const run = await check(scenario());
    const f = await assessFreshness(run, adapterFor(root));
    expect(f.current).toBe(true);
    expect(f.readiness.display).toBe(run.readiness.display);
  });
  it('changing a verified file makes its evidence stale before any recheck', async () => {
    const run = await check(scenario());
    const frozen = JSON.stringify(run);
    await fs.writeFile(path.join(root, 'Delivery/social-banner.png'), 'replaced');
    const f = await assessFreshness(run, adapterFor(root));
    const c = f.checks.find((x) => x.title.startsWith('social-banner.png'))!;
    expect(c.outcome).toBe('stale');
    expect(f.changedPaths).toEqual(['Delivery/social-banner.png']);
    expect(f.checks.find((x) => x.title.startsWith('logo.svg is in'))?.outcome).toBe('verified');
    expect(JSON.stringify(run)).toBe(frozen); // the historical run itself is untouched
  });
  it('an unrelated change cannot clear or disturb blockers', async () => {
    const run = await check(scenario());
    await fs.writeFile(path.join(root, 'Working/notes.txt'), 'different notes');
    await fs.writeFile(path.join(root, 'Working/scratch.txt'), 'new unrelated file');
    const f = await assessFreshness(run, adapterFor(root));
    expect(f.staleCheckIds).toEqual([]);
    expect(f.readiness.display).toBe('fix-before-sending');
    expect(f.readiness.counts.blocking).toBe(3);
    const again = await check(scenario());
    expect(again.readiness.counts.blocking).toBe(3);
  });
  it('a new candidate file invalidates the earlier "not found" finding', async () => {
    const run = await check(scenario());
    await fs.copyFile(path.join(root, 'Working/logo-dark.svg'), path.join(root, 'Delivery/logo-dark.svg'));
    const f = await assessFreshness(run, adapterFor(root));
    expect(f.checks.find((x) => x.title.includes('logo-dark.svg'))?.outcome).toBe('stale');
    expect(f.readiness.display).not.toBe('ready-on-checked-items');
    expect(f.checks.find((x) => x.title.includes('version 7'))?.outcome).toBe('failed');
  });
  it('a changed brief or a changed delivery boundary invalidates everything', async () => {
    const run = await check(scenario());
    const viaBoundary = await assessFreshness(run, adapterFor(root), { deliveryPath: '' });
    expect(viaBoundary.everythingStale).toBe(true);
    expect(viaBoundary.checks.every((c) => c.outcome === 'stale')).toBe(true);
    await fs.appendFile(path.join(root, 'Brief/brief.md'), '\n- Extra `extra.svg`.\n');
    const viaBrief = await assessFreshness(run, adapterFor(root));
    expect(viaBrief.everythingStale).toBe(true);
  });
  it('an older validator version invalidates cached results', async () => {
    const run = await check(scenario());
    const f = await assessFreshness({ ...run, validatorVersion: '0.0.1' }, adapterFor(root));
    expect(f.everythingStale).toBe(true);
  });
});

describe('fix → recheck', () => {
  it('adding the missing deliverable resolves its finding; the diff uses real counts', async () => {
    const first = await check(scenario());
    await applyFix(first, 'logo-dark.svg');
    await applyFix(first, 'outside the folder');
    const second = await check(scenario());
    expect(second.id).not.toBe(first.id);
    const d = diffRuns(first, second);
    expect(d.resolved.map((x) => x.title).sort()).toEqual(['This logo uses an image outside the folder you’re sending.', 'logo-dark.svg was promised but is not in the folder you’re sending.']);
    expect(d.stillOpen.map((x) => x.title)).toEqual(expect.arrayContaining([expect.stringContaining('version 7')]));
    expect(d.summary).toMatch(/^2 issues resolved\. 2 still need attention\.$/); // approval + optional favicon
    expect(d.introduced).toEqual([]);
    expect(second.readiness.counts.blocking).toBe(1);
    // The fix changed real files.
    expect(await fs.readFile(path.join(root, 'Delivery/logo.svg'), 'utf8')).toContain('href="assets/grain.png"');
    await expect(fs.access(path.join(root, 'Delivery/assets/grain.png'))).resolves.toBeUndefined();
  });
  it('the diff explains newly introduced problems', async () => {
    const first = await check(scenario());
    await fs.writeFile(path.join(root, 'Delivery/social-banner.png'), 'broken');
    const second = await check(scenario());
    const d = diffRuns(first, second);
    expect(d.newlyUnresolved.map((x) => x.title)).toEqual([expect.stringContaining('social-banner.png')]);
    expect(d.resolved).toEqual([]);
  });
  it('demo fixes refuse real folders and unmarked folders', async () => {
    const first = await check(scenario());
    const ops = first.checks.find((c) => c.repair.demoFix)!.repair.demoFix!.operations;
    await expect(applyDemoOperations({ id: 't', label: 't', kind: 'local-actual', absPath: root }, ops)).rejects.toThrow(/never modified/);
    await fs.rm(path.join(root, '.loose-ends-fixture'));
    await expect(applyDemoOperations({ id: 't', label: 't', kind: 'synthetic-fixture', absPath: root }, ops)).rejects.toThrow(/not marked/);
    await expect(applyDemoOperations({ id: 't', label: 't', kind: 'synthetic-fixture', absPath: root }, [{ op: 'copy', from: 'Working/grain.png', to: '../escape.png' }])).rejects.toThrow();
  });
  it('real folders never get demo-fix actions; manual edits are picked up on recheck', async () => {
    const first = await check({ ...scenario(), kind: 'local-actual' });
    expect(first.adapterKind).toBe('local-actual');
    expect(first.checks.some((c) => c.repair.demoFix)).toBe(false);
    await fs.copyFile(path.join(root, 'Working/logo-dark.svg'), path.join(root, 'Delivery/logo-dark.svg'));
    const second = await check({ ...scenario(), kind: 'local-actual' });
    expect(second.checks.find((c) => c.title.startsWith('logo-dark.svg'))?.outcome).toBe('verified');
  });
});

describe('approvals', () => {
  const withNote = async (note: string, extra?: () => Promise<void>) => {
    await fs.writeFile(path.join(root, 'Approvals/approval-note.md'), note);
    await extra?.();
    const run = await check(scenario());
    return run.checks.find((c) => c.id.includes('::approval:'))!;
  };
  it('latest is not approved: v7 delivered, v6 approved → failed, with the approved file located', async () => {
    const run = await check(scenario());
    const c = run.checks.find((x) => x.id.includes('::approval:'))!;
    expect(c.outcome).toBe('failed');
    expect(c.evidence.some((e) => e.label === 'The approved file exists here' && e.detail.includes('Working/brand-guidelines-v6.pdf'))).toBe(true);
    // the delivered v7 is the newest file on disk, and that changes nothing
    const now = new Date();
    await fs.utimes(path.join(root, 'Delivery/brand-guidelines-v7.pdf'), now, now);
    expect((await check(scenario())).checks.find((x) => x.id.includes('::approval:'))?.outcome).toBe('failed');
  });
  it('an ambiguous "looks good" needs review', async () => {
    const c = await withNote('The brand guidelines look good to me!\n');
    expect(c.outcome).toBe('needs-review');
    expect(c.title).toMatch(/does not say which version/);
  });
  it('no relevant approval needs review', async () => {
    expect((await withNote('Approved: the banner, version 2.\n')).outcome).toBe('needs-review');
  });
  it('filename-only approval is accepted but flagged as weaker', async () => {
    const c = await withNote('Approved: brand guidelines version 7.\n');
    expect(c.outcome).toBe('verified');
    expect(c.limitations.join(' ')).toMatch(/weaker than a content fingerprint/);
  });
  it('a content-bound approval beats a matching name', async () => {
    const c = await withNote(`Approved: brand-guidelines-v7.pdf\nsha256: ${'ab'.repeat(32)}\n`);
    expect(c.outcome).toBe('failed');
  });
  it('parses approval statements', () => {
    const s = parseApprovalRecord('a.md', 'Approved: thing-v6.pdf (version 6)\nsha256: ' + 'c'.repeat(64) + '\n\nNice weather.\n\nLooks good!');
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ explicit: true, versions: ['6'], filenames: ['thing-v6.pdf'], hashes: ['c'.repeat(64)] });
    expect(s[1].explicit).toBe(false);
  });
});
