// Minimal loopback HTTP API for the local companion. No framework.
// The browser never sends absolute paths: only a root id plus relative paths,
// validated by the adapter.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { EXTRACTOR_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION, type Requirement, type Run, type RunInput } from '../domain/model.ts';
import { LocalFsAdapter, ScopeError, normalizeRel, type AuthorizedRoot } from '../engine/adapter.ts';
import { applyDemoOperations } from '../engine/demo.ts';
import { requirementId, subjectKeyOf, derivePredicate } from '../engine/extract.ts';
import { assessFreshness, diffRuns } from '../engine/freshness.ts';
import { buildReceipt, renderReceiptHtml } from '../engine/receipt.ts';
import { createHash } from 'node:crypto';
import { ModelError, SETUP_STEPS, askAssist, probeModel, type CallRecord, type Fetcher, type ModelConfig } from '../engine/model.ts';
import { executeRun, proposeRequirements, type ProgressEvent } from '../engine/run.ts';
import { RunStore } from '../engine/store.ts';
import { ACME, EDGE_CASES, buildAcme, buildEdgeCases, resetFixture } from '../fixture/build.ts';

export interface AppConfig {
  dataDir: string;
  fixturesDir: string;
  roots: AuthorizedRoot[];
  staticDir?: string;
  /** Optional local model used only to propose promises from a brief. */
  model?: { cfg: ModelConfig; fetcher?: Fetcher } | null;
  /** Test hook: slows each progress step so cancellation can be exercised. */
  stepDelayMs?: number;
}

interface Active {
  controller: AbortController;
  events: ProgressEvent[];
  listeners: Set<http.ServerResponse>;
  done: boolean;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function createApp(cfg: AppConfig) {
  const store = new RunStore(path.join(cfg.dataDir, 'runs'));
  const active = new Map<string, Active>();
  const rootOf = (id: unknown): AuthorizedRoot => {
    const r = cfg.roots.find((x) => x.id === id);
    if (!r) throw new HttpError(400, 'Unknown folder. Choose one of the folders Loose Ends is allowed to read.');
    return r;
  };
  const adapterOf = (id: unknown) => new LocalFsAdapter(rootOf(id));
  /** A list of relative paths from the browser: must be an array of strings; each is normalised (and refused if it escapes). */
  const pathList = (v: unknown, name: string): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new HttpError(400, `${name} must be a list of paths.`);
    if (v.length > 50) throw new HttpError(400, `${name} has too many entries.`);
    return v.map((x) => normalizeRel(x));
  };
  const deliveryOf = (v: unknown): string => {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') throw new HttpError(400, 'deliveryPath must be a path.');
    return normalizeRel(v);
  };
  const decisionsOf = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 200)) if (typeof x === 'string') out[k] = x;
    return out;
  };

  // Model call log: provider, model, purpose, outcome, latency. Never brief text, never a credential.
  const logCall = (r: CallRecord) => {
    fs.mkdir(cfg.dataDir, { recursive: true })
      .then(() => fs.appendFile(path.join(cfg.dataDir, 'model-calls.jsonl'), JSON.stringify(r) + '\n'))
      .catch(() => {});
  };
  const modelError = (e: unknown): never => {
    if (e instanceof ModelError) {
      const status = e.code === 'not-configured' ? 409 : e.code === 'oversized' ? 413 : e.code === 'rate-limited' ? 429 : 502;
      throw new HttpError(status, e.message, { modelError: { code: e.code, message: e.message, action: e.action, ...(e.code === 'not-configured' ? { setup: SETUP_STEPS } : {}), model: cfg.model?.cfg.model ?? null } });
    }
    throw e;
  };
  // The promises a person confirmed (by starting a check), with the identity of the brief they came from.
  const confirmedFile = (rootId: string, briefPaths: string[]) => path.join(cfg.dataDir, 'confirmed', createHash('sha256').update(JSON.stringify([rootId, [...briefPaths].sort()])).digest('hex').slice(0, 32) + '.json');
  const briefHashes = async (adapter: LocalFsAdapter, briefPaths: string[]) => {
    const out: { path: string; sha256: string }[] = [];
    for (const p of briefPaths) out.push({ path: p, sha256: createHash('sha256').update(await adapter.readText(p)).digest('hex') });
    return out;
  };

  const presets = () => {
    const out = [];
    if (cfg.roots.some((r) => r.id === 'demo'))
      out.push({
        id: 'acme',
        rootId: 'demo',
        projectName: ACME.project,
        title: 'Acme Brand Launch (synthetic demo)',
        deliveryPath: ACME.delivery,
        briefPaths: [`${ACME.briefDir}/brief.md`],
        approvalPaths: [`${ACME.approvalsDir}/approval-note.md`],
      });
    if (cfg.roots.some((r) => r.id === 'edge'))
      for (const e of EDGE_CASES) out.push({ id: e.id, rootId: 'edge', projectName: e.title, title: `Edge case: ${e.title}`, deliveryPath: e.delivery, briefPaths: e.briefs, approvalPaths: e.approvals });
    return out;
  };

  async function readBody(req: http.IncomingMessage): Promise<any> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2_000_000) throw new HttpError(413, 'Request too large.');
      chunks.push(c);
    }
    if (chunks.length === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(400, 'Invalid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'The request body must be a JSON object.');
    return parsed;
  }

  function validateRequirements(input: unknown): Requirement[] {
    if (!Array.isArray(input)) throw new HttpError(400, 'requirements must be a list.');
    if (input.length > 2000) throw new HttpError(400, 'Too many requirements.');
    return input.map((r: any): Requirement => {
      if (!r || typeof r.text !== 'string' || !r.text.trim()) throw new HttpError(400, 'Each requirement needs text.');
      const apps = ['required', 'conditional', 'optional', 'suggestion'];
      if (!apps.includes(r.applicability)) throw new HttpError(400, 'Invalid applicability.');
      const types = ['file-included', 'image-dimensions', 'references-resolve', 'approved-version', 'manual'];
      if (!r.predicate || !types.includes(r.predicate.type)) throw new HttpError(400, 'Invalid requirement predicate.');
      if (r.predicate.type === 'image-dimensions' && !(Number.isInteger(r.predicate.width) && Number.isInteger(r.predicate.height) && r.predicate.width > 0 && r.predicate.height > 0))
        throw new HttpError(400, 'Image size must be whole positive numbers.');
      return {
        id: typeof r.id === 'string' && /^[\w-]+$/.test(r.id) ? r.id : requirementId(String(r.sourcePath ?? 'manual'), r.text),
        text: r.text,
        sourceId: String(r.sourceId ?? 'manual'),
        sourcePath: String(r.sourcePath ?? 'Added by you'),
        excerpt: String(r.excerpt ?? r.text),
        location: r.location && Number.isInteger(r.location.line) ? { line: r.location.line } : null,
        predicate: r.predicate,
        applicability: r.applicability,
        ...(r.condition ? { condition: String(r.condition) } : {}),
        ...(r.conditionResolved === 'applies' || r.conditionResolved === 'does-not-apply' ? { conditionResolved: r.conditionResolved } : {}),
        authority: 'authoritative', // recomputed by the run from sources and decisions
        origin: ['rule-based', 'model', 'manual', 'built-in'].includes(r.origin) ? r.origin : 'manual',
        subjectKey: typeof r.subjectKey === 'string' ? r.subjectKey : subjectKeyOf(r.predicate),
        enabled: r.enabled !== false,
      };
    });
  }

  function startRun(input: RunInput): string {
    const adapter = adapterOf(input.rootId);
    const controller = new AbortController();
    const runId = `run-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
    const a: Active = { controller, events: [], listeners: new Set(), done: false };
    active.set(runId, a);
    const push = (e: ProgressEvent) => {
      a.events.push(e);
      for (const l of a.listeners) l.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    (async () => {
      let pending: Promise<void> = Promise.resolve();
      const run = await executeRun(adapter, input, {
        runId,
        signal: controller.signal,
        onProgress: (e) => {
          push(e);
        },
        ...(cfg.stepDelayMs ? { beforeConsistencyCheck: () => new Promise<void>((r) => setTimeout(r, cfg.stepDelayMs)) } : {}),
      });
      await pending;
      await store.save(run);
      a.done = true;
      setTimeout(() => active.delete(runId), 10 * 60_000).unref(); // progress history is only needed while a page may still be listening
      push({ runId, phase: 'done', message: run.readiness.label, state: run.state });
      for (const l of a.listeners) l.end();
      a.listeners.clear();
    })().catch((e) => {
      a.done = true;
      push({ runId, phase: 'done', message: String(e?.message ?? e), state: 'failed' });
      for (const l of a.listeners) l.end();
    });
    return runId;
  }

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    const method = req.method ?? 'GET';

    // Loopback only: reject requests addressed to any other host (DNS-rebinding guard) and cross-site writes.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new HttpError(403, 'Loose Ends only answers on this computer.');
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) throw new HttpError(403, 'Cross-site requests are not accepted.');
      if (!(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'JSON only.');
    }

    if (!p.startsWith('/api/')) return serveStatic(p, res);

    if (method === 'GET' && p === '/api/config')
      return json(res, 200, {
        roots: cfg.roots.map((r) => ({ id: r.id, label: r.label, kind: r.kind })),
        presets: presets(),
        extraction: {
          modes: ['ai', 'rules', 'manual'],
          aiConfigured: !!cfg.model,
          modelProvider: cfg.model ? `${cfg.model.cfg.provider}:${cfg.model.cfg.model}` : null,
          setup: SETUP_STEPS,
          note: cfg.model
            ? 'AI-assisted reading uses a language model running on this computer. A suggestion is kept only if its quote is in the brief. The model never decides a result.'
            : 'No AI model is set up. Promises are read from the brief by fixed rules, or entered by hand.',
        },
        versions: { schema: SCHEMA_VERSION, validators: VALIDATOR_VERSION, extractor: EXTRACTOR_VERSION },
        externalServices: 'none',
      });

    if (method === 'GET' && p === '/api/tree') {
      const adapter = adapterOf(url.searchParams.get('rootId'));
      return json(res, 200, { path: normalizeRel(url.searchParams.get('path') ?? ''), entries: await adapter.listDir(url.searchParams.get('path') ?? '') });
    }

    if (method === 'GET' && p === '/api/file') {
      const adapter = adapterOf(url.searchParams.get('rootId'));
      const rel = normalizeRel(url.searchParams.get('path') ?? '');
      const s = await adapter.stat(rel);
      if (!s) throw new HttpError(404, 'Not found.');
      if (s.size > 8_000_000) throw new HttpError(413, 'Too large to preview.');
      const buf = await adapter.readBytes(rel, 8_000_000);
      const { sniffKind } = await import('../engine/adapter.ts');
      const kind = sniffKind(buf.subarray(0, 512), path.extname(rel).slice(1).toLowerCase());
      const types: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
      if (!types[kind]) throw new HttpError(415, 'No preview for this kind of file.');
      // Previews are only ever used in <img>. The sandbox CSP stops scripts and external loads even if opened directly.
      res.writeHead(200, {
        'Content-Type': types[kind],
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      return res.end(buf);
    }

    if (method === 'POST' && p === '/api/extract') {
      const body = await readBody(req);
      const adapter = adapterOf(body.rootId);
      const mode = body.mode === 'ai' ? 'ai' : 'rules';
      const briefPaths = pathList(body.briefPaths, 'briefPaths');
      const result = await proposeRequirements(adapter, briefPaths, pathList(body.approvalPaths, 'approvalPaths'), decisionsOf(body.authorityDecisions), { mode, model: cfg.model, log: logCall }).catch(modelError);
      let confirmed = null;
      try {
        const saved = JSON.parse(await fs.readFile(confirmedFile(String(body.rootId), briefPaths), 'utf8'));
        const now = new Map(result.sources.map((s) => [s.path, s.sha256]));
        confirmed = { ...saved, briefUnchanged: saved.sources.length === now.size && saved.sources.every((s: { path: string; sha256: string }) => now.get(s.path) === s.sha256) };
      } catch {
        /* nothing confirmed yet for this brief */
      }
      return json(res, 200, { ...result, requestedMode: mode, confirmed });
    }

    if (method === 'GET' && p === '/api/model/status') {
      if (!cfg.model) return json(res, 200, { configured: false, reachable: false, modelPresent: false, setup: SETUP_STEPS });
      const probe = await probeModel(cfg.model.cfg, cfg.model.fetcher);
      return json(res, 200, { configured: true, provider: cfg.model.cfg.provider, model: cfg.model.cfg.model, ...probe, setup: SETUP_STEPS });
    }

    if (method === 'POST' && p === '/api/requirements/derive') {
      const body = await readBody(req);
      const text = String(body.text ?? '').trim();
      if (!text) throw new HttpError(400, 'Write the promise first.');
      const predicate = derivePredicate(text);
      const r: Requirement = {
        id: requirementId('manual', text),
        text,
        sourceId: 'manual',
        sourcePath: 'Added by you',
        excerpt: text,
        location: null,
        predicate,
        applicability: body.applicability === 'optional' ? 'optional' : 'required',
        authority: 'authoritative',
        origin: 'manual',
        subjectKey: subjectKeyOf(predicate),
        enabled: true,
      };
      return json(res, 200, r);
    }

    if (method === 'POST' && p === '/api/runs') {
      const body = await readBody(req);
      rootOf(body.rootId);
      const input: RunInput = {
        projectName: String(body.projectName ?? 'Untitled project').slice(0, 200),
        rootId: body.rootId,
        deliveryPath: deliveryOf(body.deliveryPath),
        briefPaths: pathList(body.briefPaths, 'briefPaths'),
        approvalPaths: pathList(body.approvalPaths, 'approvalPaths'),
        requirements: validateRequirements(body.requirements ?? []),
        extractionMode: body.extractionMode === 'manual' ? 'manual' : 'rule-based',
        authorityDecisions: decisionsOf(body.authorityDecisions),
      };
      // Recorded from the requirements themselves, not from what the browser claims.
      if (input.requirements.some((r) => r.origin === 'model')) {
        input.extractionMode = 'model';
        if (cfg.model) input.extractionModel = `${cfg.model.cfg.provider}:${cfg.model.cfg.model}`;
      }
      // Starting a check is the act of confirming this set of promises. Keep it with the identity of its brief.
      try {
        const f = confirmedFile(String(input.rootId), input.briefPaths);
        await fs.mkdir(path.dirname(f), { recursive: true });
        await fs.writeFile(f, JSON.stringify({ savedAt: new Date().toISOString(), rootId: input.rootId, mode: input.extractionMode, model: input.extractionModel ?? null, sources: await briefHashes(adapterOf(input.rootId), input.briefPaths), requirements: input.requirements }, null, 2));
      } catch {
        /* the check itself reports unreadable briefs */
      }
      // Validate the scope before starting so a bad path is a clear error, not a failed run.
      const adapter = adapterOf(input.rootId);
      await adapter.resolve(input.deliveryPath);
      for (const b of [...input.briefPaths, ...input.approvalPaths]) await adapter.resolve(b);
      return json(res, 202, { runId: startRun(input) });
    }

    if (method === 'GET' && p === '/api/runs') return json(res, 200, { runs: await store.list() });

    const m = /^\/api\/runs\/([\w-]+)(?:\/([\w.-]+))?$/.exec(p);
    if (m) {
      const [, id, sub] = m;
      const a = active.get(id);
      if (method === 'GET' && sub === 'events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        for (const e of a?.events ?? []) res.write(`data: ${JSON.stringify(e)}\n\n`);
        if (!a || a.done) return res.end();
        a.listeners.add(res);
        req.on('close', () => a.listeners.delete(res));
        return;
      }
      if (method === 'POST' && sub === 'cancel') {
        await readBody(req);
        if (!a || a.done) return json(res, 409, { error: 'This check has already finished.' });
        a.controller.abort();
        return json(res, 202, { ok: true });
      }
      const run = await store.get(id);
      if (!run) {
        if (a && !a.done) return json(res, 200, { pending: true, events: a.events.slice(-1) });
        throw new HttpError(404, 'Run not found.');
      }
      if (method === 'GET' && !sub) return json(res, 200, { run });
      if (method === 'POST' && sub === 'assist') {
        await readBody(req);
        if (!cfg.model) modelError(new ModelError('not-configured', 'Plain-language help needs a model, and none is set up.'));
        const text = new Map(run.requirements.map((r) => [r.id, r.text]));
        const assist = await askAssist(cfg.model!.cfg, run.checks, (id) => text.get(id) ?? '', run.artifacts.map((a) => a.path), cfg.model!.fetcher, logCall).catch(modelError);
        return json(res, 200, { ...assist, model: `${cfg.model!.cfg.provider}:${cfg.model!.cfg.model}`, note: 'Written by a model from the findings above. It does not change any result.' });
      }
      if (method === 'GET' && sub === 'freshness') {
        const overrides: { deliveryPath?: string } = {};
        if (url.searchParams.has('deliveryPath')) overrides.deliveryPath = normalizeRel(url.searchParams.get('deliveryPath')!);
        return json(res, 200, await assessFreshness(run, adapterOf(run.rootId), overrides));
      }
      if (method === 'GET' && sub === 'diff') {
        const prev = await store.get(url.searchParams.get('against') ?? '');
        if (!prev) throw new HttpError(404, 'Earlier run not found.');
        return json(res, 200, diffRuns(prev, run));
      }
      if (method === 'GET' && sub === 'receipt.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="loose-ends-receipt-${id}.json"` });
        return res.end(JSON.stringify(buildReceipt(run), null, 2));
      }
      if (method === 'GET' && sub === 'receipt.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="loose-ends-receipt-${id}.html"` } : {}),
        });
        return res.end(renderReceiptHtml(run));
      }
      if (method === 'POST' && sub === 'demo-fix') {
        const body = await readBody(req);
        const check = run.checks.find((c) => c.id === body.checkId);
        if (!check?.repair.demoFix) throw new HttpError(400, 'No demo fix is available for this finding.');
        const applied = await applyDemoOperations(rootOf(run.rootId), check.repair.demoFix.operations);
        return json(res, 200, { applied });
      }
    }

    if (method === 'POST' && p === '/api/demo/reset') {
      await readBody(req);
      const done: string[] = [];
      for (const r of cfg.roots.filter((x) => x.kind === 'synthetic-fixture')) {
        if (r.id === 'demo') await resetFixture(r.absPath, cfg.fixturesDir, (d) => buildAcme(d));
        else if (r.id === 'edge') await resetFixture(r.absPath, cfg.fixturesDir, (d) => buildEdgeCases(d));
        else continue;
        done.push(r.label);
      }
      return json(res, 200, { reset: done });
    }

    throw new HttpError(404, 'Not found.');
  }

  async function serveStatic(p: string, res: http.ServerResponse) {
    if (!cfg.staticDir) throw new HttpError(404, 'Not found.');
    let decoded: string;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      throw new HttpError(400, 'Malformed address.');
    }
    const rel = normalizeRel(decoded.replace(/^\/+/, '')) || 'index.html';
    let file = path.join(cfg.staticDir, rel);
    try {
      if (!(await fs.stat(file)).isFile()) throw new Error();
    } catch {
      file = path.join(cfg.staticDir, 'index.html');
    }
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      // The app talks only to this local service and shows only its own files and inline data.
      ...(path.extname(file) === '.html'
        ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Cache-Control': 'no-store' }
        : {}),
    });
    res.end(await fs.readFile(file));
  }

  const server = http.createServer((req, res) => {
    // Nothing served here is meant to be embedded or read by another website.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : e instanceof ScopeError || e instanceof TypeError ? 400 : 500;
      const message = e instanceof HttpError || e instanceof ScopeError ? e.message : status === 400 ? 'The request was not understood.' : e instanceof Error ? e.message : 'Unexpected error.';
      if (res.headersSent) return void res.end();
      if (status === 413) {
        // The rest of an oversized upload is not read; close the connection so it cannot be mistaken for the next request.
        res.setHeader('Connection', 'close');
        const sock = req.socket;
        res.once('finish', () => sock?.destroy());
      }
      json(res, status, { error: message, ...(e instanceof HttpError && e.details ? e.details : {}) });
    });
  });
  return { server, store };
}
