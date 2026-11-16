import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CheckOutcome, CheckResult, Readiness, Requirement, Run, RunDiff } from '../../src/domain/model.ts';
import { ApiError, api, type Assist, type Config, type Extraction, type ModelProblem, type Freshness, type Preset, type Progress, type RunSummary } from './api.ts';
import { BoundaryView } from './Boundary.tsx';
import { Picker } from './Picker.tsx';

interface Selection {
  rootId: string;
  projectName: string;
  deliveryPath: string | null;
  briefPaths: string[];
  approvalPaths: string[];
}

const OUTCOME_WORDS: Record<CheckOutcome, string> = {
  verified: 'Checked',
  failed: 'Problem',
  'needs-review': 'Needs your review',
  'not-found-in-scope': 'Missing',
  'unable-to-inspect': 'Could not inspect',
  'scope-conflict': 'Conflicting instructions',
  stale: 'Out of date',
};
const TONE: Record<CheckOutcome, string> = {
  verified: 'ok',
  failed: 'bad',
  'not-found-in-scope': 'bad',
  'needs-review': 'warn',
  'unable-to-inspect': 'warn',
  'scope-conflict': 'warn',
  stale: 'warn',
};
const DISPLAY_TONE: Record<Readiness['display'], string> = {
  'fix-before-sending': 'bad',
  'needs-your-review': 'warn',
  'ready-on-checked-items': 'ok',
  'could-not-complete': 'neutral',
};
const PHASES: [string, string][] = [
  ['inventory', 'List the files'],
  ['reading-sources', 'Read the brief'],
  ['checking', 'Check each promise'],
  ['boundary', 'Work out what your client gets'],
  ['consistency', 'Make sure nothing changed meanwhile'],
];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function FileIcon({ kind }: { kind: 'folder' | 'doc' }) {
  return (
    <svg className="file-icon" viewBox="0 0 20 20" aria-hidden="true">
      {kind === 'folder' ? <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.4l1.6 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" /> : <path d="M5.5 2.5h6l3.5 3.6v9.9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 16V4a1.5 1.5 0 0 1 1.5-1.5zM11.5 2.5v3.6H15M7 10h6M7 13h4" />}
    </svg>
  );
}

const IMAGE_EXT = /\.(svg|png|jpe?g|gif|webp)$/i;
const base = (p: string) => p.split('/').pop() ?? p;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [extractError, setExtractError] = useState('');
  const [readMode, setReadMode] = useState<'ai' | 'rules' | 'manual'>('rules');
  const [modelProblem, setModelProblem] = useState<ModelProblem | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [restored, setRestored] = useState<'' | 'restored' | 'brief-changed'>('');
  const [assist, setAssist] = useState<(Assist & { runId: string }) | null>(null);
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistProblem, setAssistProblem] = useState<ModelProblem | null>(null);
  const restoredFor = useRef('');
  const [edits, setEdits] = useState<Record<string, Partial<Pick<Requirement, 'enabled' | 'conditionResolved'>>>>({});
  const [manual, setManual] = useState<Requirement[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<null | 'delivery' | 'brief' | 'approval'>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [historical, setHistorical] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [fresh, setFresh] = useState<Freshness | null>(null);
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'findings' | 'boundary'>('findings');
  const [error, setError] = useState('');
  // The most recent attempt to check produced no result. While set, whatever result is on screen is an earlier one.
  const [checkProblem, setCheckProblem] = useState('');
  const [toast, setToast] = useState('');
  const [showPromises, setShowPromises] = useState(false);
  const [showPassed, setShowPassed] = useState(false);
  const [fixNote, setFixNote] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [boundaryFocus, setBoundaryFocus] = useState<string | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Opening the evidence remembers what was focused; closing puts focus back there.
  const showMe = useCallback((id: string) => {
    if (!document.activeElement?.closest('.inspector')) openerRef.current = document.activeElement as HTMLElement | null;
    setSelected(id);
  }, []);
  const closeInspector = useCallback(() => {
    setSelected(null);
    requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus());
  }, []);
  const esRef = useRef<EventSource | null>(null);

  const refreshHistory = useCallback(() => api.runs().then((r) => setHistory(r.runs)).catch(() => {}), []);

  const usePreset = useCallback((p: Preset) => {
    setSel({ rootId: p.rootId, projectName: p.projectName, deliveryPath: p.deliveryPath, briefPaths: p.briefPaths, approvalPaths: p.approvalPaths });
    setEdits({});
    setManual([]);
    setDecisions({});
    setRun(null);
    setFresh(null);
    setDiff(null);
    setSelected(null);
    setFixNote([]);
  }, []);

  // Initial load: config, history, and the last run that was open (shown as historical, never as fresh).
  useEffect(() => {
    (async () => {
      try {
        const c = await api.config();
        setConfig(c);
        const savedMode = localStorage.getItem('loose-ends:read-mode');
        setReadMode(savedMode === 'ai' || savedMode === 'rules' || savedMode === 'manual' ? savedMode : c.extraction.aiConfigured ? 'ai' : 'rules');
        refreshHistory();
        const last = localStorage.getItem('loose-ends:last-run');
        if (last) {
          const r = await api.run(last).catch(() => null);
          if (r?.run) return openRun(r.run, true, c);
        }
        if (c.presets[0]) usePreset(c.presets[0]);
        else if (c.roots[0]) setSel({ rootId: c.roots[0].id, projectName: 'Untitled project', deliveryPath: null, briefPaths: [], approvalPaths: [] });
      } catch (e) {
        setError(`Loose Ends could not reach its local service. ${(e as Error).message}`);
      }
    })();
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRun = (r: Run, asHistorical: boolean, c: Config | null = config) => {
    setRun(r);
    setHistorical(asHistorical);
    setFresh(null);
    setSelected(null);
    if (asHistorical) setDiff(null);
    if (c?.roots.some((x) => x.id === r.rootId)) {
      setSel({ rootId: r.rootId, projectName: r.projectName, deliveryPath: r.deliveryPath, briefPaths: r.briefPaths, approvalPaths: r.approvalPaths });
      setDecisions(r.authorityDecisions ?? {});
      const e: typeof edits = {};
      for (const q of r.requirements) e[q.id] = { enabled: q.enabled, ...(q.conditionResolved ? { conditionResolved: q.conditionResolved } : {}) };
      setEdits(e);
      setManual(r.requirements.filter((q) => q.origin === 'manual'));
    }
    localStorage.setItem('loose-ends:last-run', r.id);
  };

  // Read the brief whenever the selection or an authority decision changes.
  const briefKey = sel ? `${sel.rootId}|${sel.briefPaths.join(',')}|${sel.approvalPaths.join(',')}|${JSON.stringify(decisions)}|${readMode}|${retry}` : '';
  useEffect(() => {
    if (!sel || !config) return;
    let live = true;
    setExtractError('');
    setModelProblem(null);
    setRestored('');
    // AI-assisted reading with no model set up: show the setup steps. Nothing is read by rules behind the user's back.
    if (readMode === 'ai' && !config.extraction.aiConfigured && sel.briefPaths.length) {
      setExtraction(null);
      setModelProblem({ code: 'not-configured', message: 'AI-assisted reading is not set up on this computer.', action: 'Follow these steps, or choose “Fixed rules” or “By hand”.', setup: config.extraction.setup, model: null });
      return;
    }
    setExtracting(true);
    api
      // "By hand" reads nothing from the brief; "AI-assisted" makes a real model call or fails visibly.
      .extract({ rootId: sel.rootId, briefPaths: readMode === 'manual' ? [] : sel.briefPaths, approvalPaths: sel.approvalPaths, authorityDecisions: decisions, mode: readMode === 'ai' && sel.briefPaths.length ? 'ai' : 'rules' })
      .then((x) => {
        if (!live) return;
        setExtraction(x);
        // Bring back the promises this person confirmed earlier for this exact brief (same content hash).
        const key = `${sel.rootId}|${sel.briefPaths.join(',')}`;
        if (x.confirmed && restoredFor.current !== key) {
          restoredFor.current = key;
          if (x.confirmed.briefUnchanged) {
            const e: typeof edits = {};
            for (const q of x.confirmed.requirements) e[q.id] = { enabled: q.enabled, ...(q.conditionResolved ? { conditionResolved: q.conditionResolved } : {}) };
            setEdits((cur) => ({ ...e, ...cur }));
            setManual((cur) => (cur.length ? cur : x.confirmed!.requirements.filter((q) => q.origin === 'manual')));
            setRestored('restored');
          } else setRestored('brief-changed');
        }
      })
      .catch((e) => {
        if (!live) return;
        setExtraction(null);
        const mp = (e as ApiError).modelError;
        if (mp) setModelProblem(mp);
        else setExtractError((e as Error).message);
      })
      .finally(() => live && setExtracting(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefKey, config]);

  const requirements: Requirement[] = useMemo(() => {
    const fromBrief = (extraction?.requirements ?? []).map((r) => ({ ...r, ...(edits[r.id] ?? {}) }));
    const ids = new Set(fromBrief.map((r) => r.id));
    return [...fromBrief, ...manual.filter((m) => !ids.has(m.id)).map((r) => ({ ...r, ...(edits[r.id] ?? {}) }))];
  }, [extraction, edits, manual]);

  // Staleness: compare the shown run with the files as they are now.
  const checkFreshness = useCallback(async () => {
    if (!run || runningId || run.state !== 'completed') return;
    try {
      const f = await api.freshness(run.id);
      setFresh((prev) => (prev && prev.current && f.current ? prev : f));
    } catch {
      /* folder may be gone; the run stays readable */
    }
  }, [run, runningId]);
  useEffect(() => {
    checkFreshness();
    const t = setInterval(checkFreshness, 6000);
    window.addEventListener('focus', checkFreshness);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', checkFreshness);
    };
  }, [checkFreshness]);

  // AI-assisted reading that failed, or is still running, blocks the check: there is no confirmed set to check against.
  const canCheck = Boolean(sel && sel.deliveryPath !== null && !runningId && !extracting && !(readMode === "ai" && modelProblem));

  const startCheck = async () => {
    if (!sel || sel.deliveryPath === null) return;
    setError('');
    setCheckProblem('');
    setFixNote([]);
    setEditing(false);
    const previous = run && run.state === 'completed' && run.rootId === sel.rootId && run.deliveryPath === sel.deliveryPath ? run : null;
    try {
      // Re-read the brief right before the run so edits made outside the app are picked up; user decisions are kept by id.
      // Fixed rules are instant and deterministic, so they are re-read here. A model reading is not repeated:
      // the check uses exactly the set that was shown and reviewed.
      const x = readMode === 'rules' || !extraction ? await api.extract({ rootId: sel.rootId, briefPaths: readMode === 'manual' ? [] : sel.briefPaths, approvalPaths: sel.approvalPaths, authorityDecisions: decisions, mode: 'rules' }) : extraction;
      setExtraction(x);
      setAssist(null);
      setAssistProblem(null);
      const ids = new Set(x.requirements.map((r) => r.id));
      const reqs = [...x.requirements, ...manual.filter((m) => !ids.has(m.id))].map((r) => ({ ...r, ...(edits[r.id] ?? {}) }));
      const { runId } = await api.start({
        rootId: sel.rootId,
        projectName: sel.projectName,
        deliveryPath: sel.deliveryPath,
        briefPaths: sel.briefPaths,
        approvalPaths: sel.approvalPaths,
        requirements: reqs,
        extractionMode: readMode === 'manual' || !sel.briefPaths.length ? 'manual' : 'rule-based', // the server records 'model' itself when a model-suggested promise is in the set
        authorityDecisions: decisions,
      });
      setRunningId(runId);
      setProgress({ runId, phase: 'starting', message: 'Starting', state: 'running' });
      setDiff(null);
      setFresh(null);
      setSelected(null);
      const es = new EventSource(`/api/runs/${runId}/events`);
      esRef.current = es;
      es.onmessage = (m) => setProgress(JSON.parse(m.data));
      es.onerror = async () => {
        es.close();
        let loaded = false;
        for (let i = 0; i < 100; i++) {
          const r = await api.run(runId).catch(() => null);
          if (r?.run) {
            loaded = true;
            setRun(r.run);
            setHistorical(false);
            localStorage.setItem('loose-ends:last-run', r.run.id);
            if (previous && r.run.state === 'completed') setDiff(await api.diff(r.run.id, previous.id).catch(() => null));
            break;
          }
          await new Promise((res) => setTimeout(res, 150));
        }
        if (!loaded) {
          // Never fall back to the result that was on screen as if it were this check's answer.
          setHistorical(true);
          setCheckProblem('The check started, but its result could not be loaded from the local service.');
        }
        setRunningId(null);
        setProgress(null);
        refreshHistory();
      };
    } catch (e) {
      setRunningId(null);
      setProgress(null);
      setHistorical(true);
      setCheckProblem(`The check did not run: ${(e as Error).message}`);
    }
  };

  const cancel = () => runningId && api.cancel(runningId).catch(() => {});

  const applyFix = async (c: CheckResult) => {
    if (!run) return;
    try {
      const r = await api.demoFix(run.id, c.id);
      setFixNote((n) => [...n, ...r.applied]);
      await checkFreshness();
      const f = await api.freshness(run.id);
      setFresh(f);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resetDemo = async () => {
    try {
      await api.reset();
      setFixNote([]);
      setToast('Demo files restored to their starting state.');
      setTimeout(() => setToast(''), 3500);
      if (run) setFresh(await api.freshness(run.id).catch(() => null));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast('Path copied');
    } catch {
      setToast(text);
    }
    setTimeout(() => setToast(''), 2500);
  };

  if (!config || !sel)
    return (
      <div className="boot">
        <p>{error || 'Opening Loose Ends…'}</p>
      </div>
    );

  const root = config.roots.find((r) => r.id === sel.rootId);
  const isDemo = root?.kind === 'synthetic-fixture';
  const isStale = Boolean(fresh && !fresh.current);
  const checks = isStale ? fresh!.checks : (run?.checks ?? []);
  const readiness = isStale ? fresh!.readiness : run?.readiness;
  const reqById = new Map((run?.requirements ?? []).map((r) => [r.id, r]));
  const optional = (c: CheckResult) => {
    const q = reqById.get(c.requirementId);
    return q ? q.applicability === 'optional' || q.applicability === 'suggestion' : false;
  };
  const blocking = checks.filter((c) => !optional(c) && (c.outcome === 'failed' || c.outcome === 'not-found-in-scope'));
  const review = checks.filter((c) => !optional(c) && TONE[c.outcome] === 'warn');
  const optionalOpen = checks.filter((c) => optional(c) && c.outcome !== 'verified');
  const passed = checks.filter((c) => c.outcome === 'verified');
  const selectedCheck = checks.find((c) => c.id === selected) ?? null;
  const selectionMatchesRun = run && run.rootId === sel.rootId && run.deliveryPath === sel.deliveryPath && run.briefPaths.join() === sel.briefPaths.join() && JSON.stringify(run.authorityDecisions ?? {}) === JSON.stringify(decisions);
  const groupCounts = new Map<string, number>();
  for (const c of [...blocking, ...review]) if (c.groupKey) groupCounts.set(c.groupKey, (groupCounts.get(c.groupKey) ?? 0) + 1);
  const enabledCount = requirements.filter((r) => r.enabled && r.origin !== 'built-in').length;
  const briefNotices = extraction?.notices ?? [];

  const demoFixable = (c: CheckResult) => Boolean(c.repair.demoFix && run?.adapterKind === 'synthetic-fixture' && c.outcome !== 'stale' && !historical);
  const finding = (c: CheckResult, index?: number) => {
    const req = reqById.get(c.requirementId);
    const thumbPath = c.inspected.find((i) => IMAGE_EXT.test(i.path))?.path;
    const mainPath = c.inspected[0]?.path;
    // The affected file: the one that was inspected, or — when nothing was found — the name that was promised.
    const promisedName = req && 'exactName' in req.predicate ? req.predicate.exactName : undefined;
    const missing = !mainPath && c.outcome === 'not-found-in-scope';
    const affected = mainPath ?? promisedName;
    const ext = (affected ? (base(affected).split('.').pop() ?? '') : '').slice(0, 4);
    const shared = c.groupKey ? (groupCounts.get(c.groupKey) ?? 0) : 0;
    const open = c.outcome !== 'verified';
    return (
      <li key={c.id} className={`finding tone-${TONE[c.outcome]} ${selected === c.id ? 'is-selected' : ''}`}>
        <div className={`thumb ${missing ? 'is-missing' : ''}`} aria-hidden="true">
          {thumbPath && run ? <img src={api.fileUrl(run.rootId, thumbPath, run.id)} alt="" loading="lazy" /> : <span className="glyph">{ext || '?'}</span>}
        </div>
        <div className="finding-body">
          <p className="chip-row">
            {index !== undefined && <span className="order">{index + 1}</span>}
            <span className={`chip tone-${TONE[c.outcome]}`}>{OUTCOME_WORDS[c.outcome]}</span>
            {optional(c) && <span className="chip tone-neutral">Optional</span>}
            {shared > 1 && <span className="chip tone-neutral">Shared by {shared} findings</span>}
          </p>
          <h3>{c.title}</h3>
          {affected && (
            <p className="affected">
              <span className="mono" title={affected}>
                {affected}
              </span>
              {missing && <span className="fine"> — not in {run?.deliveryPath ? base(run.deliveryPath) : 'the folder'}</span>}
            </p>
          )}
          {open && <p className="why">{c.why}</p>}
          {open && (
            <p className="next">
              <span className="next-label">Next</span>
              {c.repair.action}
            </p>
          )}
          <div className="actions">
            <button className="btn small" onClick={() => showMe(c.id)} aria-haspopup="dialog">
              Show me
            </button>
            {demoFixable(c) && (
              <button className="btn small ghost" onClick={() => applyFix(c)} title={`Demo only — changes the synthetic files: ${c.repair.demoFix!.description}`}>
                Apply demo fix
              </button>
            )}
            {demoFixable(c) && <span className="fine demo-tag">Demo files only</span>}
          </div>
        </div>
      </li>
    );
  };

  const hasBrief = sel.briefPaths.length > 0 || manual.length > 0;
  const needsAttention = Boolean(extraction?.questions.length || modelProblem || extractError || restored === 'brief-changed');
  const compact = Boolean(run && selectionMatchesRun && !editing && !needsAttention);
  const gaps = run?.coverage.gaps ?? [];
  const partial = Boolean(run && run.state === 'completed' && (gaps.length > 0 || !run.coverage.inventoryComplete));
  const phaseIndex = progress ? PHASES.findIndex((p) => p[0] === progress.phase) : -1;
  const selectedDep = selectedCheck && run ? run.dependencies.find((d) => selectedCheck.id.endsWith(`::${d.id}`)) : undefined;

  return (
    <div className={`app ${selectedCheck ? 'has-inspector' : ''}`}>
      <aside className="rail" aria-label="Project">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          Loose Ends
        </div>
        <label className="field-label" htmlFor="project-name">
          Project
        </label>
        <input id="project-name" className="project-input" value={sel.projectName} onChange={(e) => setSel({ ...sel, projectName: e.target.value })} />

        <section className="rail-block" aria-label="What is being checked">
          <h2>What’s being checked</h2>
          <dl className="facts">
            <dt>Can read</dt>
            <dd>{root?.label}</dd>
            <dt>Sending</dt>
            <dd className="mono">{sel.deliveryPath === null ? 'not chosen' : sel.deliveryPath || '(whole folder)'}</dd>
            <dt>Against</dt>
            <dd className="mono">{sel.briefPaths.length ? sel.briefPaths.map(base).join(', ') : 'no brief'}</dd>
            {run && selectionMatchesRun && (
              <>
                <dt>Files looked at</dt>
                <dd>
                  {run.coverage.filesInDelivery} in the delivery, {run.coverage.filesInScope} in total
                </dd>
                <dt>Not fully inspected</dt>
                <dd>{run.coverage.gaps.length === 0 ? 'none recorded' : `${run.coverage.gaps.length} — see findings`}</dd>
              </>
            )}
          </dl>
          <p className="fine">
            {isDemo ? 'Synthetic demo files.' : 'Real files on this computer, read-only.'} Runs on this computer; nothing is uploaded. {config?.extraction.modelProvider ? `Promises are read by fixed rules plus a local model (${config.extraction.modelProvider}); the model never decides a result.` : 'No AI model is used: promises are read from the brief by fixed rules.'}
          </p>
        </section>

        <section className="rail-block" aria-label="Earlier checks">
          <h2>Earlier checks</h2>
          {history.length === 0 && <p className="fine">None yet.</p>}
          <ul className="history">
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <button
                  className={`history-item ${run?.id === h.id ? 'is-current' : ''}`}
                  onClick={async () => {
                    const r = await api.run(h.id);
                    if (r.run) openRun(r.run, true);
                  }}
                >
                  <span className={`dot tone-${DISPLAY_TONE[h.readiness.display]}`} aria-hidden="true" />
                  <span>
                    <b>{h.readiness.label}</b>
                    <span className="fine">
                      {when(h.startedAt)} · {h.projectName}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {config.presets.length > 0 && (
          <section className="rail-block" aria-label="Demo">
            <h2>Demo files</h2>
            <select
              className="select"
              aria-label="Load a demo project"
              value={config.presets.find((p) => p.rootId === sel.rootId && p.deliveryPath === sel.deliveryPath)?.id ?? ''}
              onChange={(e) => {
                const p = config.presets.find((x) => x.id === e.target.value);
                if (p) {
                  localStorage.removeItem('loose-ends:last-run');
                  usePreset(p);
                }
              }}
            >
              <option value="" disabled>
                Load a demo project…
              </option>
              {config.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button className="btn small ghost" onClick={resetDemo}>
              Restore demo files
            </button>
          </section>
        )}
      </aside>

      <main className="main">
        <header className="page-head">
          <h1>Can I send this?</h1>
          <p className="lede">Check your folder against the brief before it reaches your client.</p>
        </header>

        {compact ? (
          <section className="choose card is-compact" aria-label="What was checked">
            <p className="summary-line">
              <span className="summary-item">
                <FileIcon kind="folder" />
                <span className="mono">{sel.deliveryPath || '(whole folder)'}</span>
              </span>
              <span className="fine">checked against</span>
              <span className="summary-item">
                <FileIcon kind="doc" />
                <span className="mono">{sel.briefPaths.length ? sel.briefPaths.map(base).join(', ') : 'promises typed by hand'}</span>
              </span>
              <span className="fine tabular">{plural(enabledCount, 'promise')}</span>
            </p>
            <div className="summary-actions">
              <button className="btn small ghost" onClick={() => setEditing(true)}>
                Change
              </button>
              {!runningId && (
                <button className="btn small primary" disabled={!canCheck} onClick={startCheck}>
                  Check again
                </button>
              )}
            </div>
          </section>
        ) : (
        <section className="choose card" aria-label="Choose">
          <div className="choose-grid">
            <div className="choice">
              <h2 className="input-label">Folder to send</h2>
              <button className="pick" onClick={() => setPicker('delivery')}>
                <FileIcon kind="folder" />
                <span className="pick-text">
                  <span className={sel.deliveryPath === null ? 'pick-empty' : 'mono pick-name'}>{sel.deliveryPath === null ? 'Choose a folder' : sel.deliveryPath || '(whole folder)'}</span>
                  <span className="fine">Only what is inside it reaches your client.</span>
                </span>
                <span className="pick-change">{sel.deliveryPath === null ? 'Choose' : 'Change'}</span>
              </button>
            </div>
            <div className="choice">
              <h2 className="input-label">What you promised</h2>
              <button className="pick" onClick={() => setPicker('brief')}>
                <FileIcon kind="doc" />
                <span className="pick-text">
                  <span className={sel.briefPaths.length ? 'mono pick-name' : 'pick-empty'}>{sel.briefPaths.length ? sel.briefPaths.join(', ') : 'Choose the brief'}</span>
                  <span className="fine">The brief or scope you agreed.</span>
                </span>
                <span className="pick-change">{sel.briefPaths.length ? 'Change' : 'Choose'}</span>
              </button>
              <button className="pick subtle" onClick={() => setPicker('approval')}>
                <span className="pick-text">
                  <span className={sel.approvalPaths.length ? 'mono pick-name' : 'fine'}>{sel.approvalPaths.length ? sel.approvalPaths.join(', ') : 'Approval notes (optional)'}</span>
                </span>
                <span className="pick-change">{sel.approvalPaths.length ? 'Change' : 'Add'}</span>
              </button>
            </div>
          </div>

          <div className="go-row">
            <button className="btn primary" disabled={!canCheck} onClick={startCheck}>
              {runningId ? 'Checking…' : run && selectionMatchesRun ? 'Check again' : 'Check before sending'}
            </button>
            <p className="fine next-hint">
              {runningId
                ? 'Progress is shown below. You can cancel there.'
                : sel.deliveryPath === null
                ? 'Choose the folder you’re sending first.'
                : !hasBrief
                  ? 'No brief chosen yet. Add one, or type the promises by hand below.'
                  : 'Next: the folder and the brief are read on this computer, and you get a short list of what to fix. Nothing is changed or uploaded.'}
            </p>
            {editing && run && (
              <button className="link" onClick={() => setEditing(false)}>
                Hide
              </button>
            )}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}

          <div className="read-mode">
            <span className="read-label">How the brief is read</span>
            <Segmented
              value={readMode}
              onChange={(m) => {
                setReadMode(m);
                localStorage.setItem('loose-ends:read-mode', m);
              }}
              options={[
                ['ai', 'AI-assisted'],
                ['rules', 'Fixed rules'],
                ['manual', 'By hand'],
              ]}
            />
            <span className="fine read-note">
              {readMode === 'ai' && (config?.extraction.aiConfigured ? `A model on this computer (${config.extraction.modelProvider}) suggests promises. Only word-for-word quotes are kept. Files are still checked by fixed validators.` : 'Not set up: needs a model on this computer.')}
              {readMode === 'rules' && 'No AI. Fixed patterns find sentences that promise something.'}
              {readMode === 'manual' && 'Nothing is read from the brief. You type the promises.'}
            </span>
          </div>
          {extracting && readMode === 'ai' && (
            <p className="fine" role="status">
              Reading the brief with the model… this can take up to a minute.
            </p>
          )}
          {modelProblem && (
            <div className="question model-problem" role="alert">
              <p>
                <b>{modelProblem.code === 'not-configured' ? 'AI-assisted reading is not set up' : 'The model did not read the brief'}</b>
              </p>
              <p>
                {modelProblem.message} No promises were taken from the brief. <span className="mono fine">[{modelProblem.code}]</span>
              </p>
              <p>{modelProblem.action}</p>
              {modelProblem.setup && (
                <ol className="setup-steps">
                  {modelProblem.setup.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              <div className="row">
                {modelProblem.code !== 'not-configured' && (
                  <button className="btn small" onClick={() => setRetry((n) => n + 1)}>
                    Try again
                  </button>
                )}
                <button className="btn small" onClick={() => setReadMode('rules')}>
                  Use fixed rules instead
                </button>
                <button className="btn small" onClick={() => setReadMode('manual')}>
                  Enter promises by hand
                </button>
              </div>
            </div>
          )}
          {restored === 'restored' && <p className="fine">Your earlier choices for this brief were restored (the brief has not changed since you confirmed them).</p>}
          {restored === 'brief-changed' && <p className="fine tone-warn-text">This brief has changed since you last confirmed its promises. Review them again before checking.</p>}
          {extractError && <p className="inline-error">Could not read the brief: {extractError}</p>}
          {extraction?.questions.map((q) => (
            <div key={q.subjectKey} className="question" role="group" aria-label="Which document should be followed?">
              <p>
                <b>{q.question}</b>
              </p>
              {q.options.map((o) => (
                <label key={o.requirementId} className="radio">
                  <input type="radio" name={q.subjectKey} checked={decisions[q.subjectKey] === o.sourcePath} onChange={() => setDecisions({ ...decisions, [q.subjectKey]: o.sourcePath })} />
                  <span>
                    <span className="mono">{o.sourcePath}</span> — “{o.text}”
                  </span>
                </label>
              ))}
              <p className="fine">A newer file is not automatically the one that counts. Until you choose, this stays open.</p>
            </div>
          ))}
          {Object.keys(decisions).length > 0 && !extraction?.questions.length && (
            <p className="fine">
              You chose which document to follow.{' '}
              <button className="link" onClick={() => setDecisions({})}>
                Undo
              </button>
            </p>
          )}

          <div className="promises">
            <button className="disclosure" aria-expanded={showPromises} onClick={() => setShowPromises(!showPromises)}>
              <span className="caret" aria-hidden="true" />
              {sel.briefPaths.length === 0 && manual.length === 0
                ? 'No brief chosen — nothing to check the folder against yet'
                : `${enabledCount} ${enabledCount === 1 ? 'promise' : 'promises'} found in the brief — review`}
            </button>
            {showPromises && (
              <PromiseReview
                requirements={requirements}
                notices={briefNotices}
                modelNote={readMode === 'manual' ? 'By hand: nothing was read from the brief.' : extraction?.mode === 'model-assisted' && extraction.model ? `AI-assisted (${extraction.model.provider}:${extraction.model.name}, ${(extraction.model.ms / 1000).toFixed(1)} s): ${extraction.model.added} suggested by the model, ${extraction.model.alsoFoundByRules} found by both, ${extraction.model.discarded} discarded because the quote was not in the brief.` : 'Fixed rules (no AI model).'}
                conflicts={extraction?.model?.suggestedConflicts ?? []}
                aiMode={extraction?.mode === 'model-assisted'}
                onToggle={(id, enabled) => setEdits({ ...edits, [id]: { ...edits[id], enabled } })}
                onCondition={(id, v) => setEdits({ ...edits, [id]: { ...edits[id], conditionResolved: v } })}
                onAdd={async (text) => {
                  const r = await api.derive(text);
                  setManual((m) => [...m.filter((x) => x.id !== r.id), r]);
                }}
                onRemoveManual={(id) => setManual((m) => m.filter((x) => x.id !== id))}
              />
            )}
          </div>

        </section>
        )}

        {runningId && progress && (
          <section className="card progress" aria-label="Checking" aria-busy="true">
            <div className="progress-head">
              <h2>
                <span className="spinner" aria-hidden="true" />
                Checking {sel.deliveryPath ? base(sel.deliveryPath) : 'the folder'}…
              </h2>
              <button className="btn small" onClick={cancel}>
                Cancel
              </button>
            </div>
            <ol className="phases">
              {PHASES.map(([id, label], i) => (
                <li key={id} className={i < phaseIndex ? 'is-done' : i === phaseIndex ? 'is-now' : ''} aria-current={i === phaseIndex ? 'step' : undefined}>
                  <span className="phase-mark" aria-hidden="true" />
                  <span>
                    {label}
                    {i === phaseIndex && progress.total ? (
                      <span className="fine tabular">
                        {' '}
                        — {progress.done ?? 0} of {progress.total}
                      </span>
                    ) : i === phaseIndex && progress.done ? (
                      <span className="fine tabular"> — {progress.done} so far</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
            {progress.total ? <progress value={progress.done ?? 0} max={progress.total} aria-label={`${progress.done ?? 0} of ${progress.total} promises checked`} /> : null}
            <p className="mono fine progress-msg" aria-live="polite">
              {progress.message}
            </p>
          </section>
        )}

        {!runningId && !run && (
          <section className="empty" aria-label="What happens next">
            <h2>What happens when you check</h2>
            <ol className="steps">
              <li>
                <b>Reads what you promised</b>
                <span>Finds the promises in the brief, each with the line it came from.</span>
              </li>
              <li>
                <b>Looks inside the folder</b>
                <span>File names, image sizes, linked files and approved versions.</span>
              </li>
              <li>
                <b>Lists what to fix</b>
                <span>A short list of findings, each with the evidence behind it.</span>
              </li>
            </ol>
          </section>
        )}

        {!runningId && checkProblem && (
          <div className="banner tone-bad" role="alert">
            <div>
              <b>{checkProblem}</b> {run ? 'Nothing below is from this attempt: it is the earlier check, shown for reference only.' : 'No result is available.'}
            </div>
            <button className="btn small" onClick={startCheck} disabled={!canCheck}>
              Try again
            </button>
          </div>
        )}
        {!runningId && run && readiness && (
          <section aria-label="Result" className="result">
            {run.state === 'cancelled' && (
              <div className="banner tone-neutral" role="status">
                <div>
                  <b>You cancelled this check.</b> {checks.length === 0 ? 'It stopped before any result was produced.' : `${plural(checks.length, 'result')} below ${checks.length === 1 ? 'was' : 'were'} produced before it stopped. The list is incomplete.`}
                </div>
                <button className="btn small primary" onClick={startCheck} disabled={!canCheck}>
                  Check again
                </button>
              </div>
            )}
            {run.state === 'failed' && (
              <div className="banner tone-bad" role="alert">
                <div>
                  <b>The check stopped with an error.</b> Nothing below should be relied on.
                  {run.failure && <p className="mono fine">{run.failure}</p>}
                </div>
                <button className="btn small primary" onClick={startCheck} disabled={!canCheck}>
                  Try again
                </button>
              </div>
            )}
            {partial && !isStale && (
              <details className="banner tone-warn partial">
                <summary>
                  <b>Partial check.</b> {!run.coverage.inventoryComplete ? 'The folder could not be listed completely. ' : ''}
                  {gaps.length > 0 ? `${plural(gaps.length, 'file or reference', 'files or references')} could not be fully inspected.` : ''} The result covers only what was checked.
                </summary>
                <ul>
                  {gaps.slice(0, 12).map((g, i) => (
                    <li key={i}>
                      {g.path && <span className="mono">{g.path} — </span>}
                      {g.reason}
                    </li>
                  ))}
                  {gaps.length > 12 && <li className="fine">and {gaps.length - 12} more in the receipt.</li>}
                </ul>
              </details>
            )}
            {historical && (
              <div className="banner tone-neutral">
                <div>
                  <b>Earlier check from {when(run.startedAt)}.</b> This is a saved result, not a fresh look at your files.
                </div>
                <button className="btn small" onClick={startCheck} disabled={!canCheck}>
                  Check again
                </button>
              </div>
            )}
            {isStale && (
              <div className="banner tone-warn" role="status">
                <div>
                  <b>Files changed since this check.</b> {fresh!.reasons.join(' ')} Affected results are marked out of date.
                  {fixNote.length > 0 && (
                    <ul className="mono fix-list">
                      {fixNote.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button className="btn small primary" onClick={startCheck} disabled={!canCheck}>
                  Check again
                </button>
              </div>
            )}
            {!selectionMatchesRun && !isStale && (
              <div className="banner tone-warn">
                <div>
                  <b>Your choices changed.</b> The result below is for the earlier selection.
                </div>
                <button className="btn small primary" onClick={startCheck} disabled={!canCheck}>
                  Check before sending
                </button>
              </div>
            )}

            <div className={`status card tone-${isStale ? 'warn' : DISPLAY_TONE[readiness.display]}`} key={run.id + String(isStale)}>
              <div className="status-icon" aria-hidden="true">
                {readiness.display === 'ready-on-checked-items' && !isStale ? (
                  <svg viewBox="0 0 24 24" className="tick">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  <span className="status-dot" />
                )}
              </div>
              <div className="status-text">
                <h2>{readiness.label}</h2>
                <ul>
                  {readiness.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p className="tally tabular">
                  <span className={blocking.length ? 'n-bad' : ''}>{blocking.length} to fix</span>
                  <span className={review.length ? 'n-warn' : ''}>{review.length} to review</span>
                  <span>{passed.length} fine</span>
                  {optionalOpen.length > 0 && <span>{optionalOpen.length} optional open</span>}
                  <span>
                    {plural(run.coverage.filesInDelivery, 'file')} in {run.deliveryPath ? base(run.deliveryPath) : 'the folder'}
                  </span>
                </p>
              </div>
              <div className="status-actions">
                <a className={`btn small ${run.finishedAt ? '' : 'is-disabled'}`} href={`/api/runs/${run.id}/receipt.html`} target="_blank" rel="noreferrer">
                  Open receipt
                </a>
                <a className="quiet-link" href={`/api/runs/${run.id}/receipt.html?download=1`}>
                  Save report
                </a>
                <a className="quiet-link" href={`/api/runs/${run.id}/receipt.json`}>
                  Save data (JSON)
                </a>
              </div>
            </div>

            {diff && !historical && !isStale && (
              <div className="banner tone-ok diff" role="status">
                <div>
                  <b>{diff.summary}</b>
                  <ul>
                    {diff.resolved.map((d) => (
                      <li key={d.checkId}>
                        <span className="chip tone-ok">Resolved</span> {d.title}
                      </li>
                    ))}
                    {[...diff.introduced, ...diff.newlyUnresolved].map((d) => (
                      <li key={d.checkId}>
                        <span className="chip tone-bad">New</span> {d.title} <span className="fine">— {d.explanation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {run.notices.filter((n) => n.kind === 'untrusted-instruction-ignored').length > 0 && (
              <div className="banner tone-neutral">
                <div>
                  <b>Ignored text that tried to instruct the checker.</b>{' '}
                  {run.notices
                    .filter((n) => n.kind === 'untrusted-instruction-ignored')
                    .map((n) => `${n.path}:${n.line}`)
                    .join(', ')}
                  . Documents are read as content only; they cannot change what is scanned or how results are decided.
                </div>
              </div>
            )}

            <Segmented value={tab} onChange={(t) => (setBoundaryFocus(null), setTab(t))} options={[['findings', `Findings (${blocking.length + review.length})`], ['boundary', 'What your client gets']]} />
            {config?.extraction.aiConfigured && run.state === 'completed' && blocking.length + review.length > 0 && (
              <span className="assist-row">
                <button
                  className="btn small"
                  disabled={assistBusy}
                  onClick={async () => {
                    setAssistBusy(true);
                    setAssistProblem(null);
                    try {
                      setAssist({ ...(await api.assist(run.id)), runId: run.id });
                    } catch (e) {
                      setAssistProblem((e as ApiError).modelError ?? { code: 'error', message: (e as Error).message, action: '', model: null });
                    } finally {
                      setAssistBusy(false);
                    }
                  }}
                >
                  {assistBusy ? 'Asking the model…' : assist?.runId === run.id ? 'Explain again (AI)' : 'Explain in plain language (AI)'}
                </button>
                {assist?.runId === run.id && <span className="fine">{assist.explanations.length} explanation(s) added — open a finding to read it. Results are unchanged.</span>}
                {assistProblem && (
                  <span className="fine tone-warn-text" role="alert">
                    No explanation was produced: {assistProblem.message} {assistProblem.action}
                  </span>
                )}
              </span>
            )}

            {tab === 'findings' ? (
              <div className="findings">
                {blocking.length > 0 && (
                  <>
                    <h2 className="group-title">To fix · {blocking.length} · in suggested order</h2>
                    <ul className="finding-list">{blocking.map((c, i) => finding(c, i))}</ul>
                  </>
                )}
                {review.length > 0 && (
                  <>
                    <h2 className="group-title">To review · {review.length}</h2>
                    <ul className="finding-list">{review.map((c) => finding(c))}</ul>
                  </>
                )}
                {blocking.length + review.length === 0 && run.state === 'completed' && (
                  <p className="calm">Nothing needs fixing among the things that were checked.</p>
                )}
                {run.state !== 'completed' && checks.length === 0 && <p className="calm">The check did not get far enough to produce results.</p>}
                {optionalOpen.length > 0 && (
                  <>
                    <h2 className="group-title">Optional · {optionalOpen.length} · does not block sending</h2>
                    <ul className="finding-list">{optionalOpen.map((c) => finding(c))}</ul>
                  </>
                )}
                {passed.length > 0 && (
                  <>
                    <button className="disclosure group-title" aria-expanded={showPassed} onClick={() => setShowPassed(!showPassed)}>
                      <span className="caret" aria-hidden="true" />
                      Checked and fine ({passed.length})
                    </button>
                    {showPassed && <ul className="finding-list">{passed.map((c) => finding(c))}</ul>}
                  </>
                )}
              </div>
            ) : (
              <BoundaryView run={run} checks={checks} onShow={showMe} initialFocus={boundaryFocus} />
            )}
          </section>
        )}
      </main>

      {selectedCheck && run && (
        <Inspector
          check={selectedCheck}
          requirement={reqById.get(selectedCheck.requirementId)}
          run={run}
          onClose={closeInspector}
          onCopy={copy}
          assist={assist && assist.runId === run.id ? assist : null}
          onBoundary={
            selectedDep && tab !== 'boundary'
              ? () => {
                  setBoundaryFocus(selectedDep.sourcePath);
                  setTab('boundary');
                  setSelected(null);
                  requestAnimationFrame(() => document.querySelector('.boundary')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
                }
              : undefined
          }
        />
      )}

      {picker && (
        <Picker
          rootId={sel.rootId}
          roots={config.roots}
          mode={picker === 'delivery' ? 'folder' : 'files'}
          title={picker === 'delivery' ? 'Folder to send' : picker === 'brief' ? 'What you promised' : 'Approval notes'}
          hint={
            picker === 'delivery'
              ? 'Choose the folder your client will receive.'
              : picker === 'brief'
                ? 'Choose the brief. Add an amendment too if there is one.'
                : 'Choose notes or messages where the client approved something.'
          }
          initial={picker === 'delivery' ? (sel.deliveryPath ? [sel.deliveryPath] : []) : picker === 'brief' ? sel.briefPaths : sel.approvalPaths}
          onClose={() => setPicker(null)}
          onChoose={(rootId, paths) => {
            const changedRoot = rootId !== sel.rootId;
            const next: Selection = changedRoot ? { rootId, projectName: sel.projectName, deliveryPath: null, briefPaths: [], approvalPaths: [] } : { ...sel };
            if (picker === 'delivery') next.deliveryPath = paths[0] ?? '';
            if (picker === 'brief') next.briefPaths = paths;
            if (picker === 'approval') next.approvalPaths = paths;
            setSel(next);
            setPicker(null);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  const index = options.findIndex((o) => o[0] === value);
  return (
    <div className="segmented" role="tablist" style={{ ['--count' as string]: options.length, ['--index' as string]: index }}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={v === value}
          tabIndex={v === value ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              const n = options[(index + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length][0];
              onChange(n);
              (e.currentTarget.parentElement?.querySelectorAll('button')[options.findIndex((o) => o[0] === n)] as HTMLElement)?.focus();
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PromiseReview(props: {
  requirements: Requirement[];
  notices: Extraction['notices'];
  modelNote?: string;
  conflicts: { a: string; b: string; about: string }[];
  aiMode: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onCondition: (id: string, v: 'applies' | 'does-not-apply') => void;
  onAdd: (text: string) => Promise<void>;
  onRemoveManual: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const kind = (r: Requirement) =>
    r.applicability === 'required' ? 'Required' : r.applicability === 'conditional' ? 'Only if…' : r.applicability === 'optional' ? 'Optional' : 'Suggestion';
  const how = (r: Requirement) => {
    const p = r.predicate;
    if (p.type === 'file-included') return `Looks for ${p.exactNames?.join(', ') ?? p.exactName ?? p.nameTokens.join(' ')} in the delivery`;
    if (p.type === 'image-dimensions') return `Reads the pixel size of ${p.exactName ?? p.nameTokens.join(' ')} (${p.width}×${p.height})`;
    if (p.type === 'approved-version') return `Compares the delivered ${p.subjectTokens.join(' ')} with the approval notes`;
    if (p.type === 'references-resolve') return r.applicability === 'suggestion' ? 'Lists links to files your client will not receive' : 'Follows images the delivered files pull in';
    return 'No automatic check — stays open for you to confirm';
  };
  return (
    <div className="promise-panel">
      <p className="fine">{props.modelNote ?? 'Read from the brief by fixed rules (no AI model).'} Untick anything that is not a real promise, or add one that was missed. These choices are kept when you check again.</p>
      {props.conflicts.map((c) => {
        const a = props.requirements.find((r) => r.id === c.a);
        const b = props.requirements.find((r) => r.id === c.b);
        if (!a || !b) return null;
        return (
          <p key={c.a + c.b} className="fine model-conflict">
            <b>The model thinks these may disagree</b> ({c.about}): “{a.text}” <span className="mono">({a.sourcePath}:{a.location?.line})</span> and “{b.text}” <span className="mono">({b.sourcePath}:{b.location?.line})</span>. This is a suggestion only — untick the one that does not apply.
          </p>
        );
      })}
      <ul className="promise-list">
        {props.requirements.map((r) => (
          <li key={r.id} className={r.enabled ? '' : 'is-off'}>
            <label className="promise">
              <input type="checkbox" checked={r.enabled} onChange={(e) => props.onToggle(r.id, e.target.checked)} />
              <span>
                <span className="promise-text">{r.text}</span>
                <span className="fine">
                  <span className="chip tone-neutral">{kind(r)}</span>
                  {r.origin === 'model' && <span className="chip tone-neutral">AI-suggested · quoted from brief</span>}
                  {r.origin === 'rule-based' && props.aiMode && <span className="chip tone-neutral">Fixed rules</span>}
                  {r.origin === 'manual' && <span className="chip tone-neutral">Added by you</span>}
                  {r.authority === 'conflicting' && <span className="chip tone-warn">Conflicts with another document</span>}
                  {r.authority === 'superseded' && <span className="chip tone-neutral">Replaced by your choice</span>} {how(r)} ·{' '}
                  <span className="mono">
                    {r.sourcePath}
                    {r.location ? `:${r.location.line}` : ''}
                  </span>
                </span>
              </span>
            </label>
            {r.applicability === 'conditional' && r.enabled && (
              <div className="condition">
                <span className="fine">Does “{r.condition}” apply?</span>
                <button className={`btn tiny ${r.conditionResolved === 'applies' ? 'is-on' : ''}`} onClick={() => props.onCondition(r.id, 'applies')}>
                  Yes
                </button>
                <button className={`btn tiny ${r.conditionResolved === 'does-not-apply' ? 'is-on' : ''}`} onClick={() => props.onCondition(r.id, 'does-not-apply')}>
                  No
                </button>
              </div>
            )}
            {r.origin === 'manual' && (
              <button className="link" onClick={() => props.onRemoveManual(r.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {props.notices.map((n, i) => (
        <p key={i} className="fine">
          {n.kind === 'untrusted-instruction-ignored' ? (
            <>
              Ignored <span className="mono">{n.path}:{n.line}</span> — it reads like an instruction to the checker, not a promise.
            </>
          ) : (
            n.message
          )}
        </p>
      ))}
      <form
        className="add-promise"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          try {
            await props.onAdd(text);
            setText('');
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        <input aria-label="Add a promise" placeholder="Add a promise, e.g. Include logo-mono.svg" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={!text.trim()}>
          Add
        </button>
      </form>
      {err && <p className="inline-error">{err}</p>}
    </div>
  );
}

function Inspector({ check, requirement, run, onClose, onCopy, assist, onBoundary }: { check: CheckResult; requirement?: Requirement; run: Run; onClose: () => void; onCopy: (t: string) => void; assist: Assist | null; onBoundary?: () => void }) {
  const plain = assist?.explanations.find((e) => e.checkId === check.id);
  const maybe = assist?.candidates.filter((c) => c.checkId === check.id) ?? [];
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollTo(0, 0);
  }, [check.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('drawer-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('drawer-open');
    };
  }, [onClose]);
  const promised = check.evidence.filter((e) => e.kind === 'source-excerpt');
  const observed = check.evidence.filter((e) => e.kind === 'observed');
  const builtIn = requirement?.origin === 'built-in';
  const file = check.inspected[0];
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="inspector" role="dialog" aria-label="Evidence for this finding" tabIndex={-1} ref={ref}>
        <div className="inspector-head">
          <span className={`chip tone-${TONE[check.outcome]}`}>{OUTCOME_WORDS[check.outcome]}</span>
          <button className="btn small ghost" onClick={onClose} aria-label="Close evidence">
            Close
          </button>
        </div>
        <h2>{check.title}</h2>

        <div className="compare">
          <section className="side side-brief" aria-label="The brief says">
            <h3>{builtIn ? 'The rule' : 'The brief says'}</h3>
            {promised.length === 0 && requirement && <blockquote>{requirement.excerpt}</blockquote>}
            {promised.map((e, i) => (
              <div key={i}>
                <blockquote>{e.detail}</blockquote>
                <p className="mono fine">
                  {e.path}
                  {e.line ? `, line ${e.line}` : ''}
                </p>
              </div>
            ))}
          </section>
          <section className="side side-file" aria-label="The file shows">
            <h3>The file shows</h3>
            {file && (
              <p className="file-row">
                {IMAGE_EXT.test(file.path) ? (
                  <span className="thumb small" aria-hidden="true">
                    <img src={api.fileUrl(run.rootId, file.path, run.id)} alt="" />
                  </span>
                ) : (
                  <span className="thumb small" aria-hidden="true">
                    <span className="glyph">{(file.path.split('.').pop() ?? '').slice(0, 4)}</span>
                  </span>
                )}
                <span className="mono">{file.path}</span>
              </p>
            )}
            <p className="fact">{check.observed}</p>
          </section>
        </div>

        <h3>Why this matters</h3>
        <p>{check.why}</p>

        {check.outcome !== 'verified' && (
          <>
            <h3>What to do next</h3>
            <p>{check.repair.action}</p>
          </>
        )}
        {onBoundary && (
          <p className="inspector-actions">
            <button className="btn small" onClick={onBoundary}>
              See where this file sits
            </button>
          </p>
        )}

        {(plain || maybe.length > 0) && (
          <div className="ai-note">
            <h3>In plain language</h3>
            {plain && <p>{plain.text}</p>}
            {maybe.map((m) => (
              <p key={m.path}>
                Possibly the same deliverable under another name: <span className="mono">{m.path}</span>. Look at it yourself — this is a guess from file names and does not change the result.
              </p>
            ))}
            <p className="fine">Written by a model ({assist!.model}) from the finding on this page. The result above comes from the checker, not the model.</p>
          </div>
        )}

        <h3>What this check cannot establish</h3>
        <ul className="limits">
          {check.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>

        <details className="technical">
          <summary>Technical details</summary>
          <h4>How it was checked</h4>
          <p className="fine">{check.method}</p>
          <h4>Files inspected</h4>
          {check.inspected.length === 0 && <p className="fine">No file was inspected for this item.</p>}
          <ul className="inspected">
            {check.inspected.map((a) => (
              <li key={a.path}>
                <span>
                  <span className="mono">{a.path}</span>
                  <span className="mono fine">
                    {a.size.toLocaleString()} bytes · {a.sha256 ? `fingerprint ${a.sha256.slice(0, 12)}…` : 'no fingerprint (size and date only)'}
                  </span>
                  <button className="link" onClick={() => onCopy(a.path)}>
                    Copy path
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {observed.length > 0 && (
            <>
              <h4>Recorded facts</h4>
              <dl className="observed">
                {observed.map((e, i) => (
                  <div key={i}>
                    <dt>{e.label}</dt>
                    <dd className="mono">
                      {e.detail}
                      {e.path && e.label !== 'Found in delivery' && e.label !== 'Candidate' ? (
                        <span className="fine">
                          {' '}
                          — in {e.path}
                          {e.line ? `, line ${e.line}` : ''}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <p className="fine mono">
            Run {run.id} · {when(run.finishedAt)}
          </p>
        </details>
      </aside>
    </>
  );
}
