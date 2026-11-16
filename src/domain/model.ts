// Loose Ends — shared domain model.
// Three separate axes are kept apart on purpose:
//   RunState      = execution state of a run
//   CheckOutcome  = verification outcome of one check
//   Applicability = how binding the requirement is
// Nothing here carries a numeric confidence or a readiness percentage.

export const SCHEMA_VERSION = '1.0.0';
export const VALIDATOR_VERSION = '1.0.0';
export const EXTRACTOR_VERSION = 'rule-based-1.0.0';

export type AdapterKind = 'local-actual' | 'synthetic-fixture' | 'native-nas-verified';

export type RunState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export type CheckOutcome =
  | 'verified'
  | 'failed'
  | 'needs-review'
  | 'not-found-in-scope'
  | 'unable-to-inspect'
  | 'scope-conflict'
  | 'stale';

export type Applicability = 'required' | 'conditional' | 'optional' | 'suggestion';

export type AuthorityStatus = 'authoritative' | 'superseded' | 'conflicting' | 'unconfirmed';

export type RequirementOrigin = 'rule-based' | 'model' | 'manual' | 'built-in';

export type ReadinessDisplay =
  | 'fix-before-sending'
  | 'needs-your-review'
  | 'ready-on-checked-items'
  | 'could-not-complete';

export const READINESS_LABEL: Record<ReadinessDisplay, string> = {
  'fix-before-sending': 'Fix before sending',
  'needs-your-review': 'Needs your review',
  'ready-on-checked-items': 'Ready on checked items',
  'could-not-complete': 'Could not complete check',
};

export interface Project {
  id: string;
  name: string;
}

export interface AuthorizedScope {
  rootId: string;
  label: string;
  adapterKind: AdapterKind;
}

/** Path of the folder that would be sent, relative to the authorized root ('' = the root itself). */
export interface DeliveryBoundary {
  deliveryPath: string;
}

export interface ScopeSource {
  id: string;
  path: string; // relative to authorized root
  role: 'brief' | 'approval-record';
  sha256: string | null;
  authority: AuthorityStatus;
  authorityBasis: string; // why this status was assigned
}

export type AcceptancePredicate =
  | { type: 'file-included'; exactName?: string; /** every file named in the sentence, when it names more than one */ exactNames?: string[]; nameTokens: string[]; extensions: string[] }
  | { type: 'image-dimensions'; exactName?: string; nameTokens: string[]; extensions: string[]; width: number; height: number }
  | { type: 'references-resolve' }
  | { type: 'approved-version'; subjectTokens: string[]; exactName?: string }
  | { type: 'manual'; description: string };

export interface Requirement {
  id: string; // stable: derived from source path + normalized text
  text: string; // the atomic commitment, as written
  sourceId: string;
  sourcePath: string;
  excerpt: string; // supporting quotation
  location: { line: number } | null;
  predicate: AcceptancePredicate;
  applicability: Applicability;
  condition?: string; // for conditional commitments
  conditionResolved?: 'applies' | 'does-not-apply';
  authority: AuthorityStatus;
  origin: RequirementOrigin;
  subjectKey: string; // used to detect conflicting commitments about the same thing
  enabled: boolean; // user can drop a requirement during review
}

export type ArtifactKind = 'png' | 'jpeg' | 'svg' | 'markdown' | 'pdf' | 'text' | 'gif' | 'webp' | 'unknown';

export interface Artifact {
  path: string; // relative to authorized root — the stable identity within a run
  name: string;
  size: number;
  mtimeMs: number;
  sha256: string | null; // null when hashing was not possible (size limit / unreadable)
  identityStrength: 'content-hash' | 'size-and-mtime';
  kind: ArtifactKind; // detected from content, not from the extension
  extension: string;
  inDelivery: boolean;
  readable: boolean;
  note?: string;
}

export type DependencyAvailability =
  | 'included-in-delivery'
  | 'available-outside-delivery'
  | 'missing-in-scope'
  | 'outside-authorized-scope'
  | 'embedded-data'
  | 'cannot-establish';

export interface Dependency {
  id: string;
  sourcePath: string;
  reference: string; // exact text of the reference as written
  referenceType: 'svg-image-href' | 'markdown-image' | 'markdown-link';
  essential: boolean; // embedded image = needed to render; plain link = informational
  resolvedTarget: string | null; // relative to authorized root, only when inside it
  availability: DependencyAvailability;
  limitations: string[];
}

export interface Evidence {
  kind: 'observed' | 'source-excerpt' | 'model-suggestion';
  label: string;
  detail: string;
  path?: string;
  line?: number;
}

export interface InspectedArtifact {
  path: string;
  sha256: string | null;
  size: number;
  identityStrength: Artifact['identityStrength'];
}

export type RepairKind =
  | 'include-missing-file'
  | 'include-referenced-asset'
  | 'confirm-approved-version'
  | 'manual-review'
  | 'resolve-authority'
  | 'fix-file'
  | 'none';

export interface RepairSuggestion {
  kind: RepairKind;
  action: string; // plain-English next step
  /** Only offered in synthetic-fixture mode. Describes real file operations. */
  demoFix?: { id: string; description: string; operations: DemoOperation[] };
}

export type DemoOperation =
  | { op: 'copy'; from: string; to: string }
  | { op: 'rewrite-reference'; file: string; from: string; to: string };

export interface CheckResult {
  id: string; // requirementId + subject
  runId: string;
  requirementId: string;
  title: string; // plain-English finding
  outcome: CheckOutcome;
  method: string; // how it was checked
  observed: string; // what was observed
  why: string; // why that creates (or does not create) a problem
  evidence: Evidence[];
  inspected: InspectedArtifact[];
  limitations: string[]; // what this check cannot establish
  repair: RepairSuggestion;
  groupKey?: string; // shared cause, derived from dependency records
  relatedPaths: string[]; // paths whose change invalidates this check
}

export interface CoverageGap {
  kind: 'unsupported-format' | 'unreadable' | 'limit-reached' | 'symlink-not-followed' | 'changed-during-inspection' | 'cancelled' | 'unsupported-reference';
  path?: string;
  reason: string;
}

export interface Coverage {
  inventoryComplete: boolean;
  filesInScope: number;
  filesInDelivery: number;
  gaps: CoverageGap[];
}

export interface Notice {
  kind: 'untrusted-instruction-ignored' | 'authority-question' | 'info';
  message: string;
  path?: string;
  line?: number;
}

export interface RunInput {
  projectName: string;
  rootId: string;
  deliveryPath: string;
  briefPaths: string[];
  approvalPaths: string[];
  requirements: Requirement[]; // the confirmed set
  extractionMode: 'rule-based' | 'model' | 'manual';
  extractionModel?: string;
  authorityDecisions: Record<string, string>; // conflict subjectKey -> chosen sourcePath
}

export interface Run {
  id: string;
  schemaVersion: string;
  validatorVersion: string;
  extractorVersion: string;
  projectName: string;
  adapterKind: AdapterKind;
  rootId: string;
  rootLabel: string;
  deliveryPath: string;
  briefPaths: string[];
  approvalPaths: string[];
  extractionMode: RunInput['extractionMode'];
  /** Provider and model that proposed promises, when extractionMode is 'model'. Never a credential. */
  extractionModel?: string;
  authorityDecisions: Record<string, string>;
  state: RunState;
  failure?: string;
  startedAt: string;
  finishedAt: string | null;
  sources: ScopeSource[];
  requirements: Requirement[];
  artifacts: Artifact[];
  dependencies: Dependency[];
  checks: CheckResult[];
  coverage: Coverage;
  notices: Notice[];
  readiness: Readiness;
}

export interface RequirementStatus {
  requirementId: string;
  outcome: CheckOutcome | 'no-check';
}

export interface Readiness {
  display: ReadinessDisplay;
  label: string;
  reasons: string[]; // every display is explainable from check records
  counts: {
    requiredRequirements: number;
    blocking: number; // required requirements with a failed / not-found check
    unresolved: number; // required requirements still not established
    verified: number; // required requirements fully verified
    optionalOpen: number; // optional / suggestion items that are not verified (never block)
  };
  perRequirement: RequirementStatus[];
}

export interface RunDiff {
  previousRunId: string;
  currentRunId: string;
  resolved: DiffEntry[];
  stillOpen: DiffEntry[];
  introduced: DiffEntry[];
  newlyUnresolved: DiffEntry[];
  unchangedVerified: number;
  summary: string;
}

export interface DiffEntry {
  checkId: string;
  title: string;
  before: CheckOutcome | null;
  after: CheckOutcome | null;
  explanation: string;
}

export const BLOCKING_OUTCOMES: CheckOutcome[] = ['failed', 'not-found-in-scope'];
export const UNRESOLVED_OUTCOMES: CheckOutcome[] = ['needs-review', 'unable-to-inspect', 'scope-conflict', 'stale'];

export const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  verified: 'Checked',
  failed: 'Problem found',
  'needs-review': 'Needs your review',
  'not-found-in-scope': 'Not in the folder you’re sending',
  'unable-to-inspect': 'Could not inspect',
  'scope-conflict': 'Conflicting instructions',
  stale: 'Out of date — check again',
};
