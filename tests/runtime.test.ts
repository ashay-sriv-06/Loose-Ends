import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScopeError, normalizeRel } from '../src/engine/adapter.ts';
import { ACME, buildAcme } from '../src/fixture/build.ts';
import { adapterFor, check, tmpRoot } from './helpers/harness.ts';

const acme = (root: string) => ({ root, delivery: ACME.delivery, briefs: ['Brief/brief.md'], approvals: ['Approvals/approval-note.md'] });

describe('authorized scope', () => {
  it.each(['../secret', '/etc/passwd', 'a/../../b', 'C:/Windows', 'a\0b', '..'])('rejects %j', (p) => {
    expect(() => normalizeRel(p)).toThrow(ScopeError);
  });
  it('normalizes harmless paths', () => {
    expect(normalizeRel('./Delivery//logo.svg')).toBe('Delivery/logo.svg');
    expect(normalizeRel('a/b/../c/')).toBe('a/c');
    expect(normalizeRel('')).toBe('');
  });
  it('refuses to read outside the authorized folder, including through symlinks', async () => {
    const outer = await tmpRoot();
    await fs.writeFile(path.join(outer, 'secret.txt'), 'private');
    const root = path.join(outer, 'authorized');
    await buildAcme(root);
    await fs.symlink(path.join(outer, 'secret.txt'), path.join(root, 'Delivery/link-to-secret.txt'));
    const adapter = adapterFor(await fs.realpath(root));
    await expect(adapter.readText('../secret.txt')).rejects.toThrow(ScopeError);
    await expect(adapter.readText('Delivery/link-to-secret.txt')).rejects.toThrow(/outside/);
    await expect(adapter.inventory('../')).rejects.toThrow(ScopeError);
    const run = await check(acme(await fs.realpath(root)));
    expect(run.artifacts.some((a) => a.path.includes('secret'))).toBe(false);
    expect(run.coverage.gaps.some((g) => g.kind === 'symlink-not-followed')).toBe(true);
    expect(run.coverage.inventoryComplete).toBe(false);
    expect(run.readiness.display).not.toBe('ready-on-checked-items');
  });
  it('a delivery path outside the root fails the run instead of scanning', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const run = await check({ ...acme(root), delivery: '../' });
    expect(run.state).toBe('failed');
    expect(run.readiness.display).toBe('could-not-complete');
    expect(run.artifacts).toEqual([]);
  });
  it('a reference that escapes the authorized folder is never opened', async () => {
    const outer = await tmpRoot();
    await fs.writeFile(path.join(outer, 'outside.png'), 'not really a png');
    const root = path.join(outer, 'authorized');
    await fs.mkdir(path.join(root, 'Delivery'), { recursive: true });
    await fs.writeFile(path.join(root, 'brief.md'), '## Deliverables\n\n- Logo `mark.svg`.\n');
    await fs.writeFile(
      path.join(root, 'Delivery/mark.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="../../outside.png"/><image href="https://example.com/x.png"/><image href="/etc/hosts"/><image href="data:image/png;base64,AAAA"/><image href="%E0%A4%A.png"/></svg>',
    );
    const run = await check({ root: await fs.realpath(root), delivery: 'Delivery', briefs: ['brief.md'] });
    const by = Object.fromEntries(run.dependencies.map((d) => [d.reference, d]));
    expect(by['../../outside.png']).toMatchObject({ availability: 'outside-authorized-scope', resolvedTarget: null });
    expect(by['https://example.com/x.png'].availability).toBe('cannot-establish');
    expect(by['/etc/hosts'].availability).toBe('cannot-establish');
    expect(by['data:image/png;base64,AAAA'].availability).toBe('embedded-data');
    expect(by['%E0%A4%A.png'].availability).toBe('cannot-establish');
    expect(run.artifacts.some((a) => a.path.includes('outside'))).toBe(false);
    expect(run.readiness.display).toBe('needs-your-review');
  });
});

describe('runs', () => {
  it('cancellation leaves an honest, non-green state', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const controller = new AbortController();
    const run = await check(acme(root), { signal: controller.signal, onProgress: (e) => e.phase === 'checking' && controller.abort() });
    expect(run.state).toBe('cancelled');
    expect(run.readiness.display).toBe('could-not-complete');
    expect(run.coverage.gaps.some((g) => g.kind === 'cancelled')).toBe(true);
    expect(run.finishedAt).not.toBeNull();
  });
  it('emits real progress events in order', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const phases: string[] = [];
    await check(acme(root), { onProgress: (e) => phases.at(-1) !== e.phase && phases.push(e.phase) });
    expect(phases).toEqual(['starting', 'inventory', 'reading-sources', 'checking', 'boundary', 'consistency', 'done']);
  });
  it('a file changed during inspection triggers a recheck and the final result reflects the new contents', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const run = await check(acme(root), {
      beforeConsistencyCheck: async () => {
        await fs.copyFile(path.join(root, 'Working/logo-dark.svg'), path.join(root, 'Delivery/logo-dark.svg'));
        const svg = path.join(root, 'Delivery/logo.svg');
        await fs.writeFile(svg, (await fs.readFile(svg, 'utf8')) + '<!-- edited -->\n');
      },
    });
    expect(run.state).toBe('completed');
    expect(run.checks.find((c) => c.title.startsWith('logo-dark.svg'))?.outcome).toBe('verified');
    const logo = run.artifacts.find((a) => a.path === 'Delivery/logo.svg')!;
    expect((await fs.stat(path.join(root, 'Delivery/logo.svg'))).size).toBe(logo.size);
  });
  it('a file that keeps changing is marked unresolved, not current', async () => {
    const root = await tmpRoot();
    await buildAcme(root, ACME, { corrected: true });
    let n = 0;
    const adapter = adapterFor(root);
    const realStat = adapter.stat.bind(adapter);
    adapter.stat = async (rel: string) => {
      const s = await realStat(rel);
      return s && rel === 'Delivery/logo.svg' ? { ...s, mtimeMs: s.mtimeMs + ++n } : s;
    };
    const { executeRun, proposeRequirements } = await import('../src/engine/run.ts');
    const proposed = await proposeRequirements(adapter, ['Brief/brief.md'], ['Approvals/approval-note.md'], {});
    const run = await executeRun(adapter, { projectName: 'x', rootId: 't', deliveryPath: 'Delivery', briefPaths: ['Brief/brief.md'], approvalPaths: ['Approvals/approval-note.md'], requirements: proposed.requirements, extractionMode: 'rule-based', authorityDecisions: {} });
    expect(run.coverage.gaps.some((g) => g.kind === 'changed-during-inspection' && g.path === 'Delivery/logo.svg')).toBe(true);
    expect(run.checks.find((c) => c.title.startsWith('logo.svg'))?.outcome).toBe('needs-review');
    expect(run.readiness.display).toBe('needs-your-review');
  });
  it('an empty brief selection can never be ready', async () => {
    const root = await tmpRoot();
    await buildAcme(root, ACME, { corrected: true });
    const run = await check({ root, delivery: 'Delivery', briefs: [] });
    expect(run.readiness.display).toBe('could-not-complete');
    expect(run.readiness.reasons.join(' ')).toMatch(/No brief/);
  });
});

describe('parser limits (2026-11-15 reliability pass)', () => {
  it('crafted Markdown and SVG cannot stall the reference scanners', async () => {
    const { scanMarkdown, scanSvg } = await import('../src/engine/references.ts');
    const t = Date.now();
    scanMarkdown('![' + '['.repeat(100_000) + '](' + '('.repeat(100_000));
    scanMarkdown('<img '.repeat(150_000));
    scanSvg('<svg xmlns="http://www.w3.org/2000/svg">' + '<image '.repeat(250_000) + '</svg>');
    expect(Date.now() - t).toBeLessThan(5000);
    // An out-of-range character reference is kept as text instead of throwing.
    expect(scanSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="&#99999999;a.png"/></svg>').refs[0].reference).toContain('a.png');
  });

  it('a model address carrying a user name or password is refused', async () => {
    const { isLoopbackUrl } = await import('../src/engine/model.ts');
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://user:secret@127.0.0.1:11434')).toBe(false);
  });
});
