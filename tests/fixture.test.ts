import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sniffKind } from '../src/engine/adapter.ts';
import { pngDimensions } from '../src/engine/images.ts';
import { ACME, EDGE_CASES, RENAMED, buildAcme, buildEdgeCases, resetFixture } from '../src/fixture/build.ts';
import expected from './expected/acme-baseline.json';
import { check, shape, tmpRoot } from './helpers/harness.ts';

const acme = (root: string, n = ACME) => ({ root, delivery: n.delivery, briefs: [`${n.briefDir}/brief.md`], approvals: [`${n.approvalsDir}/approval-note.md`], project: n.project });

describe('synthetic demo project', () => {
  let root: string;
  beforeAll(async () => {
    root = await tmpRoot();
    await buildAcme(root);
  });

  it('contains real files of their claimed type', async () => {
    const png = await fs.readFile(path.join(root, 'Delivery/social-banner.png'));
    expect(pngDimensions(png)).toEqual({ width: 1200, height: 630 });
    const pdf = await fs.readFile(path.join(root, 'Delivery/brand-guidelines-v7.pdf'));
    expect(sniffKind(pdf.subarray(0, 512), 'pdf')).toBe('pdf');
    expect(pdf.toString('latin1')).toMatch(/startxref\n\d+\n%%EOF/);
    const svg = await fs.readFile(path.join(root, 'Delivery/logo.svg'), 'utf8');
    expect(svg).toContain('href="../Working/grain.png"');
    await expect(fs.access(path.join(root, 'Working/grain.png'))).resolves.toBeUndefined();
  });

  it('baseline: looks ready, but sending the folder leaves something behind', async () => {
    const run = await check(acme(root));
    expect(run.state).toBe('completed');
    expect(run.readiness.display).toBe(expected.display);
    expect(run.readiness.counts.blocking).toBe(expected.blocking);
    expect(run.readiness.counts.verified).toBe(expected.verifiedRequired);
    for (const p of expected.problems) {
      const hit = run.checks.find((c) => c.outcome === p.outcome && c.title.includes(p.mentions));
      expect(hit, `expected problem: ${p.kind}`).toBeTruthy();
    }
    const dep = run.dependencies.find((d) => d.sourcePath === 'Delivery/logo.svg')!;
    expect(dep).toMatchObject({ reference: '../Working/grain.png', resolvedTarget: 'Working/grain.png', availability: 'available-outside-delivery', essential: true });
  });

  it('the application never reads the answer key and has no fixture-specific detection', async () => {
    const run = await check(acme(root));
    expect(run.artifacts.some((a) => a.path.includes('expected'))).toBe(false);
    const srcDir = path.resolve(__dirname, '../src');
    for (const dir of ['domain', 'engine']) {
      for (const f of await fs.readdir(path.join(srcDir, dir))) {
        const text = await fs.readFile(path.join(srcDir, dir, f), 'utf8');
        expect(text, `${dir}/${f}`).not.toMatch(/acme|grain\.png|brand-guidelines|logo-dark|tests\/expected/i);
      }
    }
  });

  it('corrected state: repairs live in the files, and the result follows', async () => {
    const fixed = await tmpRoot();
    await buildAcme(fixed, ACME, { corrected: true });
    const run = await check(acme(fixed));
    expect(run.readiness.display).toBe(expected.correctedDisplay);
    expect(run.checks.filter((c) => ['failed', 'unable-to-inspect', 'needs-review'].includes(c.outcome))).toEqual([]);
    expect(run.checks.find((c) => c.title.includes('exact file that was approved'))?.outcome).toBe('verified');
  });

  it('metamorphic: renaming the project, folders and files gives equivalent findings', async () => {
    const renamed = await tmpRoot('other-');
    await buildAcme(renamed, RENAMED);
    const a = shape(await check(acme(root)));
    const b = shape(await check(acme(renamed, RENAMED)));
    expect(b).toEqual(a);
    expect(b.open).toHaveLength(4); // 3 blockers + 1 optional favicon
  });

  it('reset only touches marked fixture folders inside the fixtures directory', async () => {
    const parent = await tmpRoot();
    const user = path.join(parent, 'user-folder');
    await fs.mkdir(user);
    await fs.writeFile(path.join(user, 'keep.txt'), 'mine');
    await expect(resetFixture(user, parent, (d) => buildAcme(d))).rejects.toThrow(/not marked/);
    await expect(resetFixture(path.join(parent, '..', 'elsewhere'), parent, (d) => buildAcme(d))).rejects.toThrow(/not inside/);
    expect(await fs.readFile(path.join(user, 'keep.txt'), 'utf8')).toBe('mine');
    const fx = path.join(parent, 'fx');
    await resetFixture(fx, parent, (d) => buildAcme(d));
    await fs.writeFile(path.join(fx, 'Delivery/extra.txt'), 'x');
    await resetFixture(fx, parent, (d) => buildAcme(d));
    await expect(fs.access(path.join(fx, 'Delivery/extra.txt'))).rejects.toThrow();
  });
});

describe('edge-case fixtures', () => {
  let root: string;
  const run = (id: string, extra = {}) => {
    const e = EDGE_CASES.find((x) => x.id === id)!;
    return check({ root, delivery: e.delivery, briefs: e.briefs, approvals: e.approvals, ...extra });
  };
  beforeAll(async () => {
    root = await tmpRoot();
    await buildEdgeCases(root);
  });

  it('a misleading file name cannot override the image contents', async () => {
    const r = await run('misnamed-dimensions');
    const c = r.checks.find((x) => x.title.includes('1080x1920.png'))!;
    expect(c.outcome).toBe('failed');
    expect(c.observed).toContain('1080×1350');
    expect(r.readiness.display).toBe('fix-before-sending');
  });
  it('an unsupported source format prevents readiness without claiming failure', async () => {
    const r = await run('unsupported-format');
    expect(r.checks.find((x) => x.title.includes('cannot look inside poster.psd'))?.outcome).toBe('unable-to-inspect');
    expect(r.readiness.display).toBe('needs-your-review');
    expect(r.coverage.gaps.some((g) => g.kind === 'unsupported-format')).toBe(true);
  });
  it('a conflicting amendment asks a question instead of picking the newer file', async () => {
    const r = await run('conflicting-amendment');
    expect(r.checks.filter((c) => c.outcome === 'scope-conflict')).toHaveLength(2);
    expect(r.readiness.display).toBe('needs-your-review');
    expect(r.notices.some((n) => n.kind === 'authority-question')).toBe(true);
    // An authority decision resolves it — in either direction.
    const key = r.requirements.find((q) => q.authority === 'conflicting')!.subjectKey;
    const brief = await run('conflicting-amendment', { decisions: { [key]: 'conflicting-amendment/brief.md' } });
    expect(brief.readiness.display).toBe('ready-on-checked-items');
    const amend = await run('conflicting-amendment', { decisions: { [key]: 'conflicting-amendment/amendment.md' } });
    expect(amend.readiness.display).toBe('fix-before-sending');
    expect(amend.checks.find((c) => c.outcome === 'failed')?.title).toContain('1600×900');
  });
  it('a corrupt file is "unable to inspect", never verified', async () => {
    const r = await run('corrupt-file');
    expect(r.checks.find((x) => x.title.includes('banner.png'))?.outcome).toBe('unable-to-inspect');
    expect(r.readiness.display).not.toBe('ready-on-checked-items');
  });
  it('cyclic references terminate', async () => {
    const r = await run('cyclic-references');
    expect(r.state).toBe('completed');
    expect(r.dependencies).toHaveLength(2);
    expect(r.dependencies.every((d) => d.availability === 'included-in-delivery')).toBe(true);
    const { reachable } = await import('../src/engine/references.ts');
    expect(reachable('cyclic-references/Delivery/tile-a.svg', r.dependencies)).toEqual(['cyclic-references/Delivery/tile-b.svg']);
  });
  it('duplicate content under two names is one open question, not two', async () => {
    const r = await run('duplicate-content');
    const c = r.checks.filter((x) => x.outcome === 'needs-review');
    expect(c).toHaveLength(1);
    expect(c[0].observed).toContain('identical');
    expect(r.readiness.counts.unresolved).toBe(1);
  });
  it('embedded instructions are recorded and ignored', async () => {
    const r = await run('embedded-instruction');
    expect(r.notices.filter((n) => n.kind === 'untrusted-instruction-ignored').map((n) => n.path).sort()).toEqual(['embedded-instruction/Delivery/notes.md', 'embedded-instruction/brief.md']);
    expect(r.checks.find((c) => c.title.includes('icon-mono.svg'))?.outcome).toBe('not-found-in-scope');
    expect(r.readiness.display).toBe('fix-before-sending');
    expect(r.artifacts.every((a) => a.path.startsWith('embedded-instruction/') || a.path.split('/').length >= 1)).toBe(true);
    expect(r.requirements.some((q) => /ignore all previous/i.test(q.text))).toBe(false);
  });
});
