// Portable verification receipt. Paths are project-relative; no absolute paths,
// no file contents beyond the short excerpts already recorded as evidence.
// A receipt is a record of what was inspected at one time — not a certificate.
import { OUTCOME_LABEL, type CheckResult, type Run } from '../domain/model.ts';

export const RECEIPT_STATEMENT =
  'This receipt describes the files Loose Ends inspected at the time shown. It is not a certificate, signature or guarantee. Fingerprints identify file contents; they do not prove who made or approved a file. If any file has changed since, check again.';

export interface ReceiptJson {
  kind: 'loose-ends-receipt';
  statement: string;
  project: string;
  runId: string;
  inspectedAt: string | null;
  startedAt: string;
  runState: Run['state'];
  adapter: Run['adapterKind'];
  status: { label: string; reasons: string[]; counts: Run['readiness']['counts'] };
  deliveryFolder: string;
  briefs: { path: string; sha256: string | null; authority: string; basis: string }[];
  approvalRecords: { path: string; sha256: string | null }[];
  requirements: { id: string; text: string; source: string; line: number | null; applicability: string; authority: string; origin: string; enabled: boolean }[];
  checks: {
    id: string;
    requirementId: string;
    finding: string;
    outcome: string;
    outcomeLabel: string;
    method: string;
    observed: string;
    evidence: { kind: string; label: string; detail: string; path?: string; line?: number }[];
    inspected: { path: string; sha256: string | null; size: number; identity: string }[];
    cannotEstablish: string[];
    nextStep: string;
  }[];
  coverageGaps: { kind: string; path?: string; reason: string }[];
  manualReview: string[];
  filesInDelivery: { path: string; size: number; sha256: string | null; type: string }[];
  versions: { schema: string; validators: string; extractor: string; extractionMode: string };
}

export function buildReceipt(run: Run): ReceiptJson {
  return {
    kind: 'loose-ends-receipt',
    statement: RECEIPT_STATEMENT,
    project: run.projectName,
    runId: run.id,
    inspectedAt: run.finishedAt,
    startedAt: run.startedAt,
    runState: run.state,
    adapter: run.adapterKind,
    status: { label: run.readiness.label, reasons: run.readiness.reasons, counts: run.readiness.counts },
    deliveryFolder: run.deliveryPath || '.',
    briefs: run.sources.filter((s) => s.role === 'brief').map((s) => ({ path: s.path, sha256: s.sha256, authority: s.authority, basis: s.authorityBasis })),
    approvalRecords: run.sources.filter((s) => s.role === 'approval-record').map((s) => ({ path: s.path, sha256: s.sha256 })),
    requirements: run.requirements.map((r) => ({
      id: r.id,
      text: r.text,
      source: r.sourcePath,
      line: r.location?.line ?? null,
      applicability: r.applicability,
      authority: r.authority,
      origin: r.origin,
      enabled: r.enabled,
    })),
    checks: run.checks.map((c) => ({
      id: c.id,
      requirementId: c.requirementId,
      finding: c.title,
      outcome: c.outcome,
      outcomeLabel: OUTCOME_LABEL[c.outcome],
      method: c.method,
      observed: c.observed,
      evidence: c.evidence.map((e) => ({ kind: e.kind, label: e.label, detail: e.detail, ...(e.path ? { path: e.path } : {}), ...(e.line ? { line: e.line } : {}) })),
      inspected: c.inspected.map((i) => ({ path: i.path, sha256: i.sha256, size: i.size, identity: i.identityStrength })),
      cannotEstablish: c.limitations,
      nextStep: c.repair.action,
    })),
    coverageGaps: run.coverage.gaps.map((g) => ({ kind: g.kind, ...(g.path ? { path: g.path } : {}), reason: g.reason })),
    manualReview: run.checks.filter((c) => c.outcome === 'needs-review' || c.outcome === 'unable-to-inspect' || c.outcome === 'scope-conflict').map((c) => c.title),
    filesInDelivery: run.artifacts.filter((a) => a.inDelivery).map((a) => ({ path: a.path, size: a.size, sha256: a.sha256, type: a.kind })),
    versions: { schema: run.schemaVersion, validators: run.validatorVersion, extractor: run.extractorVersion, extractionMode: run.extractionMode },
  };
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TONE: Record<string, string> = {
  verified: '#28634A',
  failed: '#B44732',
  'not-found-in-scope': '#B44732',
  'needs-review': '#8C641A',
  'unable-to-inspect': '#8C641A',
  'scope-conflict': '#8C641A',
  stale: '#8C641A',
};

/** Self-contained HTML report: no scripts, no external requests. Readable without the app. */
export function renderReceiptHtml(run: Run): string {
  const r = buildReceipt(run);
  const open = r.checks.filter((c) => c.outcome !== 'verified');
  const passed = r.checks.filter((c) => c.outcome === 'verified');
  const check = (c: ReceiptJson['checks'][number]) => `
  <article class="check">
    <p class="tag" style="color:${TONE[c.outcome] ?? '#20231F'}">${esc(c.outcomeLabel)}</p>
    <h3>${esc(c.finding)}</h3>
    <dl>
      <dt>How it was checked</dt><dd>${esc(c.method)}</dd>
      <dt>What was observed</dt><dd>${esc(c.observed)}</dd>
      <dt>Evidence</dt><dd>${
        c.evidence.length
          ? `<ul>${c.evidence.map((e) => `<li><b>${esc(e.label)}:</b> ${esc(e.detail)}${e.path ? ` <code>${esc(e.path)}${e.line ? `:${e.line}` : ''}</code>` : ''}</li>`).join('')}</ul>`
          : 'No evidence items recorded.'
      }</dd>
      <dt>Files inspected</dt><dd>${
        c.inspected.length
          ? `<ul>${c.inspected.map((i) => `<li><code>${esc(i.path)}</code> · ${i.size} bytes · ${i.sha256 ? `sha256 <code>${esc(i.sha256)}</code>` : 'no fingerprint (size and date only)'}</li>`).join('')}</ul>`
          : 'None.'
      }</dd>
      <dt>What this cannot establish</dt><dd>${c.cannotEstablish.length ? `<ul>${c.cannotEstablish.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '—'}</dd>
      ${c.outcome === 'verified' ? '' : `<dt>Next step</dt><dd>${esc(c.nextStep)}</dd>`}
    </dl>
  </article>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Loose Ends receipt — ${esc(r.project)}</title>
<style>
body{margin:0;background:#F5F3EE;color:#20231F;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:36px 0 10px;border-bottom:1px solid #d9d5cb;padding-bottom:6px}h3{font-size:15px;margin:2px 0 8px}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;word-break:break-all}
.status{font-size:20px;font-weight:650;margin:14px 0 4px}.note{background:#FFFEFB;border:1px solid #d9d5cb;border-radius:8px;padding:12px 14px;margin:16px 0}
.check{background:#FFFEFB;border:1px solid #d9d5cb;border-radius:8px;padding:14px 16px;margin:10px 0;overflow-wrap:anywhere}
.tag{font-size:12px;font-weight:650;letter-spacing:.03em;text-transform:uppercase;margin:0}
dl{margin:0}dt{font-size:12px;color:#5c6058;margin-top:8px}dd{margin:0}ul{margin:2px 0;padding-left:18px}
table{border-collapse:collapse;width:100%;background:#FFFEFB}td,th{border:1px solid #d9d5cb;padding:6px 8px;text-align:left;vertical-align:top;font-size:13px;overflow-wrap:anywhere}
.muted{color:#5c6058}
</style></head><body><main>
<p class="muted">Loose Ends · inspection receipt</p>
<h1>${esc(r.project)}</h1>
<p class="muted">Run <code>${esc(r.runId)}</code> · inspected ${esc(r.inspectedAt ?? 'not finished')} · ${esc(adapterWords(r.adapter))}</p>
<p class="status">${esc(r.status.label)}${r.runState !== 'completed' ? ` — run ${esc(r.runState)}` : ''}</p>
<ul>${r.status.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
<div class="note">${esc(r.statement)}</div>

<h2>What was checked</h2>
<table>
<tr><th>Folder being sent</th><td><code>${esc(r.deliveryFolder)}</code> (${r.filesInDelivery.length} files)</td></tr>
<tr><th>Brief</th><td>${r.briefs.length ? r.briefs.map((b) => `<code>${esc(b.path)}</code> — ${esc(b.authority)} (${esc(b.basis)})`).join('<br>') : 'No brief was provided.'}</td></tr>
<tr><th>Approval records</th><td>${r.approvalRecords.length ? r.approvalRecords.map((b) => `<code>${esc(b.path)}</code>`).join('<br>') : 'None provided.'}</td></tr>
<tr><th>Tool versions</th><td>schema ${esc(r.versions.schema)} · validators ${esc(r.versions.validators)} · requirement reading: ${esc(r.versions.extractionMode)} (${esc(r.versions.extractor)})</td></tr>
</table>

<h2>Promises applied (${r.requirements.filter((q) => q.enabled).length})</h2>
<table><tr><th>Promise</th><th>Source</th><th>Kind</th></tr>
${r.requirements
  .filter((q) => q.enabled)
  .map((q) => `<tr><td>${esc(q.text)}</td><td><code>${esc(q.source)}${q.line ? `:${q.line}` : ''}</code></td><td>${esc(q.applicability)}${q.authority !== 'authoritative' ? ` · ${esc(q.authority)}` : ''}</td></tr>`)
  .join('\n')}
</table>

<h2>Needs attention (${open.length})</h2>
${open.length ? open.map(check).join('') : '<p>No open items among the things that were checked.</p>'}

<h2>Passed (${passed.length})</h2>
${passed.length ? passed.map(check).join('') : '<p>Nothing passed.</p>'}

<h2>Coverage gaps (${r.coverageGaps.length})</h2>
${r.coverageGaps.length ? `<ul>${r.coverageGaps.map((g) => `<li>${g.path ? `<code>${esc(g.path)}</code> — ` : ''}${esc(g.reason)}</li>`).join('')}</ul>` : '<p>None recorded. This does not mean everything about the files was checked — see each item’s limits.</p>'}

<h2>Files in the delivery at inspection time</h2>
<table><tr><th>File</th><th>Type</th><th>Bytes</th><th>sha256</th></tr>
${r.filesInDelivery.map((f) => `<tr><td><code>${esc(f.path)}</code></td><td>${esc(f.type)}</td><td>${f.size}</td><td><code>${esc(f.sha256 ?? '—')}</code></td></tr>`).join('\n')}
</table>
</main></body></html>`;
}

function adapterWords(a: Run['adapterKind']): string {
  return a === 'synthetic-fixture' ? 'synthetic demo files on this computer' : a === 'local-actual' ? 'real files on this computer (not a NAS run)' : 'UGREEN NAS';
}

export type { CheckResult };
