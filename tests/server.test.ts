import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.ts';
import { buildAcme, buildEdgeCases } from '../src/fixture/build.ts';
import { tmpRoot } from './helpers/harness.ts';

let base: string;
let close: () => Promise<void>;
let fixtures: string;
let real: string;
let setDelay: (ms: number) => void;

const api = async (p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + p, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
};
const waitRun = async (runId: string) => {
  for (let i = 0; i < 200; i++) {
    const r = await api(`/api/runs/${runId}`);
    if (r.json?.run) return r.json.run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('run did not finish');
};
const startAcme = async (rootId = 'demo', overrides: Record<string, unknown> = {}) => {
  const sel = { rootId, deliveryPath: 'Delivery', briefPaths: ['Brief/brief.md'], approvalPaths: ['Approvals/approval-note.md'] };
  const ex = await api('/api/extract', sel);
  const r = await api('/api/runs', { ...sel, projectName: 'Acme Brand Launch', requirements: ex.json.requirements, extractionMode: 'rule-based', ...overrides });
  return r;
};

beforeAll(async () => {
  fixtures = await tmpRoot();
  real = await tmpRoot('real-');
  await buildAcme(path.join(fixtures, 'acme'));
  await buildEdgeCases(path.join(fixtures, 'edge'));
  await buildAcme(real);
  await fs.rm(path.join(real, '.loose-ends-fixture'));
  const cfg = {
    dataDir: await tmpRoot(),
    fixturesDir: fixtures,
    roots: [
      { id: 'demo', label: 'Demo', kind: 'synthetic-fixture' as const, absPath: path.join(fixtures, 'acme') },
      { id: 'edge', label: 'Edge', kind: 'synthetic-fixture' as const, absPath: path.join(fixtures, 'edge') },
      { id: 'local-1', label: 'Real', kind: 'local-actual' as const, absPath: real },
    ],
    stepDelayMs: 0,
  };
  setDelay = (ms) => (cfg.stepDelayMs = ms);
  const { server } = createApp(cfg);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((r) => server.close(() => r()));
});
afterAll(() => close());

describe('local API', () => {
  it('describes its folders, adapters and the absence of a model provider', async () => {
    const { json } = await api('/api/config');
    expect(json.roots.map((r: any) => r.kind)).toEqual(['synthetic-fixture', 'synthetic-fixture', 'local-actual']);
    expect(JSON.stringify(json)).not.toContain(fixtures);
    expect(json.extraction.modelProvider).toBeNull();
    expect(json.externalServices).toBe('none');
  });
  it('rejects unknown roots, traversal and absolute paths', async () => {
    expect((await api('/api/tree?rootId=nope')).status).toBe(400);
    expect((await api('/api/tree?rootId=demo&path=../')).status).toBe(400);
    expect((await api('/api/file?rootId=demo&path=/etc/hosts')).status).toBe(400);
    expect((await api('/api/extract', { rootId: 'demo', briefPaths: ['../../x.md'] })).status).toBe(400);
    expect((await api('/api/runs', { rootId: 'demo', deliveryPath: '../..', briefPaths: [], requirements: [] })).status).toBe(400);
    expect((await api('/api/runs', { rootId: '/tmp', deliveryPath: '', briefPaths: [], requirements: [] })).status).toBe(400);
  });
  it('rejects other hosts and cross-site writes', async () => {
    const http = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: '/api/config', headers: { Host: 'evil.example' } }, (r) => resolve(r.statusCode!));
    });
    expect(status).toBe(403);
    expect((await api('/api/demo/reset', {}, { Origin: 'https://evil.example' })).status).toBe(403);
  });
  it('previews are sandboxed and limited to images', async () => {
    const svg = await api('/api/file?rootId=demo&path=Delivery/logo.svg');
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('content-security-policy')).toContain('sandbox');
    expect((await api('/api/file?rootId=demo&path=Brief/brief.md')).status).toBe(415);
  });
  it('full flow: extract → run → events → fix → recheck → diff → receipt → reload', async () => {
    const started = await startAcme();
    expect(started.status).toBe(202);
    const first = await waitRun(started.json.runId);
    expect(first.readiness.label).toBe('Fix before sending');
    expect(first.adapterKind).toBe('synthetic-fixture');
    const events = (await api(`/api/runs/${first.id}/events`)).text;
    expect(events).toContain('"phase":"inventory"');
    expect(events).toContain('"phase":"done"');

    for (const c of first.checks.filter((c: any) => c.repair.demoFix)) {
      const fx = await api(`/api/runs/${first.id}/demo-fix`, { checkId: c.id });
      expect(fx.status).toBe(200);
    }
    const fresh = await api(`/api/runs/${first.id}/freshness`);
    expect(fresh.json.current).toBe(false);
    expect(fresh.json.readiness.display).toBe('fix-before-sending'); // approval blocker is unaffected

    const second = await waitRun((await startAcme()).json.runId);
    const diff = (await api(`/api/runs/${second.id}/diff?against=${first.id}`)).json;
    expect(diff.resolved).toHaveLength(2);
    expect(second.readiness.counts.blocking).toBe(1);

    const html = await api(`/api/runs/${second.id}/receipt.html`);
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(html.text).toContain(second.id);
    const rj = await api(`/api/runs/${second.id}/receipt.json`);
    expect(rj.json.kind).toBe('loose-ends-receipt');

    const list = (await api('/api/runs')).json.runs;
    expect(list.map((r: any) => r.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect((await api(`/api/runs/${first.id}`)).json.run.readiness.counts.blocking).toBe(3); // history is immutable

    const reset = await api('/api/demo/reset', {});
    expect(reset.json.reset).toEqual(['Demo', 'Edge']);
    const third = await waitRun((await startAcme()).json.runId);
    expect(third.readiness.counts.blocking).toBe(3);
  });
  it('real folders are read-only: no demo fix, reset leaves them alone', async () => {
    const run = await waitRun((await startAcme('local-1')).json.runId);
    expect(run.adapterKind).toBe('local-actual');
    const c = run.checks.find((c: any) => c.outcome === 'not-found-in-scope');
    expect((await api(`/api/runs/${run.id}/demo-fix`, { checkId: c.id })).status).toBe(400);
    await api('/api/demo/reset', {});
    await expect(fs.access(path.join(real, 'Delivery/logo.svg'))).resolves.toBeUndefined();
  });
  it('cancel and restart never mix results', async () => {
    setDelay(300);
    const a = (await startAcme()).json.runId;
    await new Promise((r) => setTimeout(r, 60));
    expect((await api(`/api/runs/${a}`)).json.pending).toBe(true);
    expect((await api(`/api/runs/${a}/cancel`, {})).status).toBe(202);
    setDelay(0);
    const b = (await startAcme()).json.runId;
    const [ra, rb] = [await waitRun(a), await waitRun(b)];
    expect(ra.state).toBe('cancelled');
    expect(ra.readiness.label).toBe('Could not complete check');
    expect(rb.state).toBe('completed');
    expect(rb.checks.every((c: any) => c.runId === b)).toBe(true);
    expect(ra.checks.every((c: any) => c.runId === a)).toBe(true);
    expect((await api(`/api/runs/${a}/cancel`, {})).status).toBe(409);
  });
  it('validates requirement input and supports manual requirements', async () => {
    const d = await api('/api/requirements/derive', { text: 'Include `logo-dark.svg`' });
    expect(d.json).toMatchObject({ origin: 'manual', predicate: { type: 'file-included', exactName: 'logo-dark.svg' } });
    const bad = await api('/api/runs', { rootId: 'demo', deliveryPath: 'Delivery', briefPaths: [], requirements: [{ text: 'x', applicability: 'required', predicate: { type: 'eval' } }] });
    expect(bad.status).toBe(400);
    const run = await waitRun((await api('/api/runs', { rootId: 'demo', deliveryPath: 'Delivery', briefPaths: [], requirements: [d.json], extractionMode: 'manual' })).json.runId);
    expect(run.extractionMode).toBe('manual');
    expect(run.readiness.label).toBe('Fix before sending');
  });
});

describe('hardening (2026-11-15 reliability pass)', () => {
  it('malformed selections are refused with 400, not a server error', async () => {
    for (const bad of [{ briefPaths: 'Brief/brief.md' }, { briefPaths: [5] }, { approvalPaths: { a: 1 } }, { deliveryPath: {} }]) {
      // reading the brief does not use the delivery folder, so only the run endpoint validates it
      if (!('deliveryPath' in bad)) expect((await api('/api/extract', { rootId: 'demo', deliveryPath: 'Delivery', briefPaths: [], approvalPaths: [], ...bad })).status).toBe(400);
      expect((await api('/api/runs', { rootId: 'demo', deliveryPath: 'Delivery', briefPaths: [], approvalPaths: [], requirements: [], ...bad })).status).toBe(400);
    }
    expect((await api('/api/extract', [] as unknown)).status).toBe(400);
  });

  it('responses cannot be embedded by another site, and approval paths are scope-checked on extract', async () => {
    const r = await api('/api/file?rootId=demo&path=Delivery/logo.svg');
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect((await api('/api/extract', { rootId: 'demo', briefPaths: [], approvalPaths: ['../x'] })).status).toBe(400);
  });

  it('a demo fix refuses to write or read through a symlink that leads out of the demo folder', async () => {
    const { applyDemoOperations } = await import('../src/engine/demo.ts');
    const outside = await tmpRoot('outside-');
    const demo = { id: 'demo', label: 'Demo', kind: 'synthetic-fixture' as const, absPath: path.join(fixtures, 'acme') };
    await fs.symlink(outside, path.join(demo.absPath, 'Delivery/planted'));
    await expect(applyDemoOperations(demo, [{ op: 'copy', from: 'Working/logo-dark.svg', to: 'Delivery/planted/x.svg' }])).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.rm(path.join(demo.absPath, 'Delivery/planted'));
  });
});
