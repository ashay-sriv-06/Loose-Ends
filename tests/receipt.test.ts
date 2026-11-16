import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReceipt, renderReceiptHtml } from '../src/engine/receipt.ts';
import { RunStore } from '../src/engine/store.ts';
import { ACME, buildAcme } from '../src/fixture/build.ts';
import { check, tmpRoot } from './helpers/harness.ts';

const scenario = (root: string) => ({ root, delivery: 'Delivery', briefs: ['Brief/brief.md'], approvals: ['Approvals/approval-note.md'], project: ACME.project });

describe('receipt', () => {
  it('is readable on its own and makes no certification claims', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const run = await check(scenario(root));
    const html = renderReceiptHtml(run);
    const json = buildReceipt(run);
    expect(html).toContain('Fix before sending');
    expect(html).toContain('This logo uses an image outside the folder you’re sending.');
    expect(html).toContain('What this cannot establish');
    expect(html).toContain(run.id);
    expect(html).not.toMatch(/<script|src=|href="http/i);
    const claims = (html + JSON.stringify(json)).replace(/It is not a certificate, signature or guarantee\./g, '').replace(/does not authenticate a signer/g, '');
    expect(claims).not.toMatch(/certified|tamper-proof|legally|guarantee|\bsigned\b/i);
    expect(json.statement).toMatch(/at the time shown/);
    expect(json.checks).toHaveLength(run.checks.length);
    expect(json.versions).toMatchObject({ schema: '1.0.0', extractionMode: 'rule-based' });
    expect(json.filesInDelivery.every((f) => f.sha256?.length === 64)).toBe(true);
  });
  it('uses project-relative paths only', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const run = await check(scenario(root));
    const all = renderReceiptHtml(run) + JSON.stringify(buildReceipt(run)) + JSON.stringify(run);
    expect(all).not.toContain(root);
    expect(all).not.toMatch(/\/Users\/|\/private\/|\/var\/folders/);
  });
  it('escapes hostile names and survives long filenames', async () => {
    const root = await tmpRoot();
    await fs.mkdir(path.join(root, 'Delivery'));
    const evil = '<img src=x onerror=alert(1)>&"\'.svg';
    const long = 'a-very-long-file-name-'.repeat(9) + '.png';
    await fs.writeFile(path.join(root, 'Delivery', evil), '<svg xmlns="http://www.w3.org/2000/svg"><image href="missing <b>.png"/></svg>');
    await fs.writeFile(path.join(root, 'Delivery', long), 'not a png');
    await fs.writeFile(path.join(root, 'brief.md'), `## Deliverables\n- Image \`${long}\` at 10×10 px.\n- <script>alert(1)</script> must be included as \`x.svg\`.\n`);
    const run = await check({ root, delivery: 'Delivery', briefs: ['brief.md'], project: '<b>Proj</b>' });
    const html = renderReceiptHtml(run);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>Proj</b>');
    expect(html).toContain('&lt;b&gt;Proj&lt;/b&gt;');
    expect(html).toContain(long);
  });
  it('handles empty evidence, no brief, and partial (cancelled) runs honestly', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const controller = new AbortController();
    controller.abort();
    const run = await check(scenario(root), { signal: controller.signal });
    expect(run.state).toBe('cancelled');
    const html = renderReceiptHtml(run);
    expect(html).toContain('Could not complete check');
    expect(html).toContain('run cancelled');
    expect(buildReceipt(run).coverageGaps.some((g) => g.kind === 'cancelled')).toBe(true);
    const empty = await check({ root, delivery: 'Delivery', briefs: [], edit: () => [] });
    expect(renderReceiptHtml(empty)).toContain('No brief was provided.');
    expect(buildReceipt({ ...empty, checks: [{ ...run.checks[0] ?? ({} as any), id: 'x', requirementId: 'x', title: 't', outcome: 'needs-review', method: '', observed: '', why: '', evidence: [], inspected: [], limitations: [], repair: { kind: 'none', action: '' }, relatedPaths: [] }] }).checks[0].evidence).toEqual([]);
  });
  it('stored runs reopen after a restart and cannot be overwritten', async () => {
    const root = await tmpRoot();
    await buildAcme(root);
    const dir = path.join(await tmpRoot(), 'runs');
    const run = await check(scenario(root));
    await new RunStore(dir).save(run);
    const reopened = await new RunStore(dir).get(run.id); // fresh instance = reload
    expect(reopened).toEqual(JSON.parse(JSON.stringify(run)));
    await expect(new RunStore(dir).save({ ...run, projectName: 'changed' })).rejects.toThrow();
    expect((await new RunStore(dir).list())[0]).toMatchObject({ id: run.id, projectName: ACME.project });
    await expect(new RunStore(dir).get('../../etc/passwd')).resolves.toBeNull();
  });
});
