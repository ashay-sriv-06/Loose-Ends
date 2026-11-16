import type { AdapterKind, CheckResult, Notice, Readiness, Requirement, Run, RunDiff } from '../../src/domain/model.ts';

export interface Preset {
  id: string;
  rootId: string;
  projectName: string;
  title: string;
  deliveryPath: string;
  briefPaths: string[];
  approvalPaths: string[];
}
export interface Config {
  roots: { id: string; label: string; kind: AdapterKind }[];
  presets: Preset[];
  extraction: { modes: string[]; aiConfigured: boolean; modelProvider: string | null; setup: string[]; note: string };
  versions: { schema: string; validators: string; extractor: string };
}
export interface TreeEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}
export interface AuthorityQuestion {
  subjectKey: string;
  question: string;
  options: { sourcePath: string; requirementId: string; text: string }[];
}
export interface Extraction {
  requirements: Requirement[];
  notices: Notice[];
  questions: AuthorityQuestion[];
  mode: string;
  requestedMode?: 'ai' | 'rules';
  model?: { used: boolean; provider: string | null; name: string | null; added: number; alsoFoundByRules: number; refined: number; discarded: number; ms: number; suggestedConflicts: { a: string; b: string; about: string }[] };
  confirmed?: null | { savedAt: string; briefUnchanged: boolean; mode: string; model: string | null; requirements: Requirement[] };
}
export interface ModelProblem {
  code: string;
  message: string;
  action: string;
  setup?: string[];
  model: string | null;
}
export interface Assist {
  explanations: { checkId: string; text: string }[];
  candidates: { checkId: string; path: string }[];
  discarded: number;
  model: string;
  note: string;
}
export class ApiError extends Error {
  modelError?: ModelProblem;
}
export interface Freshness {
  runId: string;
  current: boolean;
  everythingStale: boolean;
  reasons: string[];
  staleCheckIds: string[];
  checks: CheckResult[];
  readiness: Readiness;
}
export interface RunSummary {
  id: string;
  projectName: string;
  state: Run['state'];
  startedAt: string;
  finishedAt: string | null;
  rootId: string;
  deliveryPath: string;
  adapterKind: AdapterKind;
  readiness: Readiness;
}
export interface Progress {
  runId: string;
  phase: string;
  message: string;
  done?: number;
  total?: number;
  state: Run['state'];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new ApiError(data.error ?? `Request failed (${res.status})`);
    if (data.modelError) e.modelError = data.modelError;
    throw e;
  }
  return data as T;
}

export const api = {
  config: () => call<Config>('/api/config'),
  tree: (rootId: string, path: string) => call<{ path: string; entries: TreeEntry[] }>(`/api/tree?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}`),
  extract: (b: { rootId: string; briefPaths: string[]; approvalPaths: string[]; authorityDecisions: Record<string, string>; mode: 'ai' | 'rules' }) => call<Extraction>('/api/extract', b),
  assist: (id: string) => call<Assist>(`/api/runs/${id}/assist`, {}),
  derive: (text: string) => call<Requirement>('/api/requirements/derive', { text }),
  start: (b: unknown) => call<{ runId: string }>('/api/runs', b),
  run: (id: string) => call<{ run?: Run; pending?: boolean }>(`/api/runs/${id}`),
  runs: () => call<{ runs: RunSummary[] }>('/api/runs'),
  cancel: (id: string) => call<{ ok: boolean }>(`/api/runs/${id}/cancel`, {}),
  freshness: (id: string) => call<Freshness>(`/api/runs/${id}/freshness`),
  diff: (id: string, against: string) => call<RunDiff>(`/api/runs/${id}/diff?against=${against}`),
  demoFix: (id: string, checkId: string) => call<{ applied: string[] }>(`/api/runs/${id}/demo-fix`, { checkId }),
  reset: () => call<{ reset: string[] }>('/api/demo/reset', {}),
  fileUrl: (rootId: string, path: string, v = '') => `/api/file?rootId=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}${v ? `&v=${v}` : ''}`,
};
