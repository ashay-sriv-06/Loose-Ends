// The small set of real validators. Each returns CheckResult records that keep
// observed evidence separate from anything suggested, and state their limits.
import type {
  AcceptancePredicate,
  Artifact,
  CheckOutcome,
  CheckResult,
  CoverageGap,
  Dependency,
  Evidence,
  InspectedArtifact,
  Notice,
  RepairSuggestion,
  Requirement,
} from '../domain/model.ts';
import { LIMITS, type FileAdapter } from './adapter.ts';
import { tokensOf, BOUNDARY_REQUIREMENT_ID, INJECTION_RE, LINKS_REQUIREMENT_ID } from './extract.ts';
import { jpegDimensions, pngDimensions } from './images.ts';
import { resolveReference, scanMarkdown, scanSvg, type ResolveContext } from './references.ts';

export interface CheckContext {
  runId: string;
  adapter: FileAdapter;
  deliveryPath: string;
  artifacts: Artifact[];
  inventoryComplete: boolean;
  approvalRecords: { path: string; text: string }[];
  gaps: CoverageGap[];
  notices: Notice[];
  demoFixes: boolean; // only true for the synthetic fixture
}

const SELF_CONTAINED = new Set(['png', 'jpeg', 'gif', 'webp', 'pdf', 'text']);

function inspected(a: Artifact): InspectedArtifact {
  return { path: a.path, sha256: a.sha256, size: a.size, identityStrength: a.identityStrength };
}
function sourceEvidence(r: Requirement): Evidence {
  return { kind: 'source-excerpt', label: r.origin === 'built-in' ? 'Built-in check' : 'What was promised', detail: r.excerpt, path: r.sourcePath, ...(r.location ? { line: r.location.line } : {}) };
}
function nameTokens(name: string): string[] {
  return name
    .normalize('NFC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
function extOf(a: Artifact): string {
  return a.extension === 'jpeg' ? 'jpg' : a.extension;
}

/** Candidate files by name. Names identify candidates; they prove nothing about content. */
export function candidates(p: { exactName?: string; nameTokens?: string[]; subjectTokens?: string[]; extensions?: string[] }, pool: Artifact[]): Artifact[] {
  if (p.exactName) {
    const lc = (s: string) => s.normalize('NFC').toLowerCase();
    const want = lc(p.exactName);
    const wantBase = want.split('/').pop()!;
    return pool.filter((a) => lc(a.path) === want || lc(a.path).endsWith('/' + want) || lc(a.name) === wantBase);
  }
  const tokens = p.nameTokens ?? p.subjectTokens ?? [];
  if (tokens.length === 0) return [];
  return pool.filter((a) => {
    const nt = nameTokens(a.name);
    const okExt = !p.extensions || p.extensions.length === 0 || p.extensions.includes(extOf(a));
    return okExt && tokens.every((t) => nt.some((n) => n === t || n === t + 's' || n + 's' === t));
  });
}

/**
 * When no file name contains every word of the promise, the single file of the right type that shares the most
 * words with it. A weak, name-only lead: it may be measured, but it is never enough on its own to call a promise met.
 */
export function partialCandidate(p: { exactName?: string; nameTokens?: string[]; extensions?: string[] }, pool: Artifact[]): Artifact | null {
  const tokens = p.nameTokens ?? [];
  if (p.exactName || tokens.length < 2) return null;
  const scored = pool
    .map((a) => {
      const nt = nameTokens(a.name);
      const okExt = !p.extensions || p.extensions.length === 0 || p.extensions.includes(extOf(a));
      return { a, n: okExt ? tokens.filter((t) => nt.some((x) => x === t || x === t + 's' || x + 's' === t)).length : 0 };
    })
    .filter((x) => x.n > 0);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((x) => x.n));
  const top = scored.filter((x) => x.n === best);
  return top.length === 1 ? top[0].a : null;
}

function describeWanted(p: { exactName?: string; nameTokens?: string[]; subjectTokens?: string[]; extensions?: string[] }): string {
  if (p.exactName) return p.exactName;
  const t = (p.nameTokens ?? p.subjectTokens ?? []).join(' ');
  return p.extensions?.length ? `${t} (${p.extensions.join('/').toUpperCase()})` : t;
}

function base(ctx: CheckContext, r: Requirement, subject: string): Pick<CheckResult, 'id' | 'runId' | 'requirementId'> {
  return { id: `${r.id}::${subject}`, runId: ctx.runId, requirementId: r.id };
}

const NO_REPAIR: RepairSuggestion = { kind: 'none', action: 'Nothing to do.' };

export async function runRequirementCheck(ctx: CheckContext, r: Requirement): Promise<CheckResult[]> {
  if (r.authority === 'conflicting') {
    return [
      {
        ...base(ctx, r, 'authority'),
        title: `Two documents disagree — ${r.sourcePath.split('/').pop()} says: “${r.text}”`,
        outcome: 'scope-conflict',
        method: 'Compared the commitments extracted from each selected brief document.',
        observed: `“${r.text}” (${r.sourcePath}) conflicts with another document about the same deliverable.`,
        why: 'Until you say which document wins, Loose Ends cannot know what was promised, so it will not mark this as checked.',
        evidence: [sourceEvidence(r)],
        inspected: [],
        limitations: ['A newer file date does not make a document the one that counts.'],
        repair: { kind: 'resolve-authority', action: 'Choose which document to follow, then check again.' },
        relatedPaths: [r.sourcePath],
      },
    ];
  }
  switch (r.predicate.type) {
    case 'file-included': {
      const p = r.predicate;
      if (p.exactNames && p.exactNames.length > 1) {
        const out: CheckResult[] = [];
        for (const name of p.exactNames) out.push(await checkFileIncluded(ctx, r, { ...p, exactName: name, exactNames: undefined }));
        return out;
      }
      return [await checkFileIncluded(ctx, r, p)];
    }
    case 'image-dimensions':
      return [await checkDimensions(ctx, r, r.predicate)];
    case 'approved-version':
      return [checkApproval(ctx, r, r.predicate)];
    case 'manual':
      return [
        {
          ...base(ctx, r, 'manual'),
          title: 'This promise needs a human look.',
          outcome: 'needs-review',
          method: 'None — Loose Ends has no automatic check for this kind of commitment.',
          observed: 'Not inspected.',
          why: 'The brief asks for something Loose Ends cannot measure from the files, so it stays open until you confirm it yourself.',
          evidence: [sourceEvidence(r)],
          inspected: [],
          limitations: ['No file was inspected for this item.'],
          repair: { kind: 'manual-review', action: 'Check this item yourself before sending.' },
          relatedPaths: [r.sourcePath],
        },
      ];
    case 'references-resolve':
      return []; // handled by boundary analysis
  }
}

function conditionNote(r: Requirement): string[] {
  return r.applicability === 'conditional' && !r.conditionResolved ? [`This only applies ${r.condition ?? 'under a condition'} — Loose Ends cannot tell whether that condition holds.`] : [];
}

async function checkFileIncluded(ctx: CheckContext, r: Requirement, p: Extract<AcceptancePredicate, { type: 'file-included' }>): Promise<CheckResult> {
  const delivery = ctx.artifacts.filter((a) => a.inDelivery);
  const found = candidates(p, delivery);
  const wanted = describeWanted(p);
  const method = p.exactName ? `Looked for a file named ${p.exactName} inside the folder being sent.` : `Looked inside the folder being sent for a file whose name contains: ${wanted}.`;
  const common = { ...base(ctx, r, `file:${wanted}`), method, relatedPaths: [r.sourcePath] };

  if (found.length === 1) {
    const a = found[0];
    const expectKind: Record<string, string> = { svg: 'svg', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', pdf: 'pdf', gif: 'gif', webp: 'webp' };
    const exp = expectKind[a.extension];
    if (!a.readable || (exp && a.kind !== exp)) {
      return {
        ...common,
        title: `${a.name} is there, but its contents are not a valid ${a.extension.toUpperCase()} file.`,
        outcome: 'unable-to-inspect',
        observed: `Found ${a.path}. Its contents were detected as “${a.kind}”, not ${a.extension.toUpperCase()}.`,
        why: 'A file with the right name that will not open does not meet the promise. Loose Ends cannot confirm it.',
        evidence: [sourceEvidence(r), { kind: 'observed', label: 'File contents', detail: `Detected type: ${a.kind}; size ${a.size} bytes.`, path: a.path }],
        inspected: [inspected(a)],
        limitations: ['Type detection looks at the start of the file only.'],
        repair: { kind: 'fix-file', action: `Re-export ${a.name} and check again.` },
        relatedPaths: [r.sourcePath, a.path],
      };
    }
    return {
      ...common,
      title: `${a.name} is in the folder you’re sending.`,
      outcome: 'verified',
      observed: `Found ${a.path} (${a.kind}, ${a.size} bytes).`,
      why: 'The promised file is inside the delivery folder.',
      evidence: [sourceEvidence(r), { kind: 'observed', label: 'Found in delivery', detail: a.path, path: a.path }],
      inspected: [inspected(a)],
      limitations: ['Confirms a file with this name and type is present. It does not judge what the file looks like or whether it is the right design.', ...conditionNote(r)],
      repair: NO_REPAIR,
      relatedPaths: [r.sourcePath, a.path],
    };
  }
  if (found.length > 1 && p.exactName && found.every((a) => a.name.normalize('NFC').toLowerCase() === p.exactName!.split('/').pop()!.normalize('NFC').toLowerCase())) {
    // Several files carry exactly the promised name (for example in print/ and web/). The promise that the file is included is met.
    return {
      ...common,
      title: `${p.exactName} is in the folder you’re sending (${found.length} copies).`,
      outcome: 'verified',
      observed: `Found ${found.length} files with this exact name: ${found.map((a) => a.path).join(', ')}.${found.every((a) => a.sha256 && a.sha256 === found[0].sha256) ? ' Their contents are identical.' : ' Their contents differ.'}`,
      why: 'A file with the promised name is inside the delivery folder.',
      evidence: [sourceEvidence(r), ...found.map((a): Evidence => ({ kind: 'observed', label: 'Found in delivery', detail: a.path, path: a.path }))],
      inspected: found.map(inspected),
      limitations: ['Confirms files with this name are present. It does not say which copy your client should use.', ...conditionNote(r)],
      repair: NO_REPAIR,
      relatedPaths: [r.sourcePath, ...found.map((a) => a.path)],
    };
  }
  if (found.length > 1) {
    return {
      ...common,
      title: `More than one file could be “${wanted}”.`,
      outcome: 'needs-review',
      observed: `${found.length} candidates in the delivery: ${found.map((a) => a.path).join(', ')}.${
        found.every((a) => a.sha256 && a.sha256 === found[0].sha256) ? ' Their contents are identical (same fingerprint), so one is a duplicate under another name.' : ''
      }`,
      why: 'Loose Ends will not guess which file you meant. Counted once, not once per candidate.',
      evidence: [sourceEvidence(r), ...found.map((a): Evidence => ({ kind: 'observed', label: 'Candidate', detail: a.path, path: a.path }))],
      inspected: found.map(inspected),
      limitations: ['Candidates were matched by file name only.'],
      repair: { kind: 'manual-review', action: 'Keep only the file you intend to send, or name the exact file in the requirement.' },
      relatedPaths: [r.sourcePath, ...found.map((a) => a.path)],
    };
  }
  if (!ctx.inventoryComplete) {
    return {
      ...common,
      title: `Could not finish looking for ${wanted}.`,
      outcome: 'unable-to-inspect',
      observed: 'The folder scan was incomplete, so “not found” cannot be trusted.',
      why: 'An incomplete scan cannot prove a file is missing or present.',
      evidence: [sourceEvidence(r)],
      inspected: [],
      limitations: ['Scan incomplete.'],
      repair: { kind: 'manual-review', action: 'Check again once the whole folder can be scanned.' },
    };
  }
  const maybe = partialCandidate(p, delivery);
  if (maybe) {
    return {
      ...common,
      title: `${maybe.name} might be the promised ${wanted} — please confirm.`,
      outcome: 'needs-review',
      observed: `No file name contains all of: ${wanted}. ${maybe.path} has the right type and shares part of the name.`,
      why: 'A partial name match is a lead, not proof. Loose Ends will not count this promise as met on a guess.',
      evidence: [sourceEvidence(r), { kind: 'observed', label: 'Possible match', detail: maybe.path, path: maybe.path }],
      inspected: [inspected(maybe)],
      limitations: ['Matched on part of the file name only.'],
      repair: { kind: 'manual-review', action: `If ${maybe.name} is the promised file, name it exactly in the requirement (or rename the file), then check again.` },
      relatedPaths: [r.sourcePath, maybe.path],
    };
  }
  const elsewhere = candidates(p, ctx.artifacts.filter((a) => !a.inDelivery));
  const evidence: Evidence[] = [
    sourceEvidence(r),
    { kind: 'observed', label: 'Looked in', detail: `${delivery.length} files in ${ctx.deliveryPath || 'the selected folder'}; none matched.` },
  ];
  let repair: RepairSuggestion = { kind: 'include-missing-file', action: `Add ${wanted} to the folder you’re sending, then check again.` };
  if (elsewhere.length > 0) {
    evidence.push({ kind: 'observed', label: 'Found outside the delivery', detail: elsewhere.map((a) => a.path).join(', '), path: elsewhere[0].path });
    const src = elsewhere[0];
    const to = joinRel(ctx.deliveryPath, src.name);
    repair = {
      kind: 'include-missing-file',
      action: `Copy ${src.path} into the folder you’re sending, then check again.`,
      ...(ctx.demoFixes && elsewhere.length === 1
        ? { demoFix: { id: `copy:${src.path}`, description: `Copies ${src.path} to ${to} in the demo folder.`, operations: [{ op: 'copy', from: src.path, to }] } }
        : {}),
    };
  }
  return {
    ...common,
    title: `${wanted} was promised but is not in the folder you’re sending.`,
    outcome: 'not-found-in-scope',
    observed: elsewhere.length ? `No match inside the delivery. A matching file exists at ${elsewhere.map((a) => a.path).join(', ')}, outside it.` : 'No match inside the delivery or anywhere else Loose Ends was allowed to look.',
    why: 'Your client only receives what is inside the folder you send.',
    evidence,
    inspected: [],
    limitations: ['Matching is by file name. A file with a different name would not be recognised.', ...conditionNote(r)],
    repair,
    relatedPaths: [r.sourcePath, ...elsewhere.map((a) => a.path)],
  };
}

function joinRel(a: string, b: string): string {
  return a ? `${a}/${b}` : b;
}

async function checkDimensions(ctx: CheckContext, r: Requirement, p: Extract<AcceptancePredicate, { type: 'image-dimensions' }>): Promise<CheckResult> {
  const delivery = ctx.artifacts.filter((a) => a.inDelivery);
  let found = candidates(p, delivery);
  // No file name contains every word of the promise: measure the single closest image, but treat the match as weak.
  const lead = found.length === 0 ? partialCandidate(p, delivery.filter((a) => a.kind === 'png' || a.kind === 'jpeg')) : null;
  const weak = !!lead;
  if (lead) found = [lead];
  const wanted = describeWanted(p);
  const want = `${p.width}×${p.height}`;
  const common = {
    ...base(ctx, r, `dimensions:${wanted}`),
    method: 'Read the pixel size stored inside the image file itself. The file name is not used as evidence.',
    relatedPaths: [r.sourcePath, ...found.map((a) => a.path)],
  };
  if (found.length === 0) {
    return {
      ...common,
      title: `${wanted} (${want}) was promised but is not in the folder you’re sending.`,
      outcome: ctx.inventoryComplete ? 'not-found-in-scope' : 'unable-to-inspect',
      observed: ctx.inventoryComplete ? 'No matching image inside the delivery.' : 'The folder scan was incomplete.',
      why: 'Your client only receives what is inside the folder you send.',
      evidence: [sourceEvidence(r)],
      inspected: [],
      limitations: ['Matching is by file name.'],
      repair: { kind: 'include-missing-file', action: `Add the ${want} image to the delivery, then check again.` },
    };
  }
  if (found.length > 1) {
    return {
      ...common,
      title: `More than one image could be “${wanted}”.`,
      outcome: 'needs-review',
      observed: `${found.length} candidates: ${found.map((a) => a.path).join(', ')}.`,
      why: 'Loose Ends will not guess which image you meant.',
      evidence: [sourceEvidence(r)],
      inspected: found.map(inspected),
      limitations: ['Candidates were matched by file name only.'],
      repair: { kind: 'manual-review', action: 'Name the exact file in the requirement, or remove the extra candidates.' },
    };
  }
  const a = found[0];
  let dims = null;
  let readError = false;
  if (a.kind === 'png' || a.kind === 'jpeg') {
    try {
      const buf = await ctx.adapter.readBytes(a.path);
      dims = a.kind === 'png' ? pngDimensions(buf) : jpegDimensions(buf);
    } catch {
      readError = true;
    }
  }
  if (!dims) {
    const supported = a.kind === 'png' || a.kind === 'jpeg';
    return {
      ...common,
      title: `Could not read the size of ${a.name}.`,
      outcome: 'unable-to-inspect',
      observed: readError
        ? 'The file could not be read.'
        : supported
          ? `The file starts like a ${a.kind.toUpperCase()} but its size information is damaged or missing.`
          : `The file’s contents were detected as “${a.kind}”. Pixel size can only be read from PNG and JPEG files.`,
      why: 'Without a readable size, Loose Ends cannot say the image matches the brief.',
      evidence: [sourceEvidence(r), { kind: 'observed', label: 'Detected type', detail: a.kind, path: a.path }],
      inspected: [inspected(a)],
      limitations: ['Only PNG and JPEG pixel sizes are supported.'],
      repair: { kind: supported ? 'fix-file' : 'manual-review', action: supported ? `Re-export ${a.name}; it appears damaged.` : `Check the size of ${a.name} yourself.` },
    };
  }
  const got = `${dims.width}×${dims.height}`;
  const ok = dims.width === p.width && dims.height === p.height;
  return {
    ...common,
    title: ok ? (weak ? `${a.name} is ${got} and might be the promised ${wanted} — please confirm.` : `${a.name} is ${got}, as promised.`) : `${a.name} is ${got}, but the brief asks for ${want}.`,
    // A weak name match with the right size is a lead to confirm, never a pass. With the wrong size it is worth fixing or ruling out.
    outcome: ok ? (weak ? 'needs-review' : 'verified') : 'failed',
    observed: `Pixel size stored in the file: ${got}.`,
    why: ok ? 'The image matches the size in the brief.' : 'The image your client receives would be the wrong size, whatever its file name says.',
    evidence: [sourceEvidence(r), { kind: 'observed', label: 'Actual pixel size', detail: `${got} (read from the ${a.kind.toUpperCase()} header)`, path: a.path }],
    inspected: [inspected(a)],
    limitations: ['Checks pixel size only — not colour, sharpness or content.', ...(weak ? [`${a.name} was picked because it shares part of its name with the promise (${wanted}); no file name matched completely.`] : []), ...conditionNote(r)],
    repair: ok ? NO_REPAIR : { kind: 'fix-file', action: `Re-export ${a.name} at ${want}, then check again.` },
  };
}

// ---------- approvals ----------

export interface ApprovalStatement {
  recordPath: string;
  line: number;
  text: string;
  explicit: boolean;
  versions: string[];
  filenames: string[];
  hashes: string[];
}

const APPROVE_WORD = /\b(approved?|approval|signed[- ]off|sign[- ]off|go ahead with|confirmed)\b/i;
const VAGUE_WORD = /\b(looks? (good|great|fine)|lgtm|love it|perfect|nice work|happy with)\b/i;

export function parseApprovalRecord(recordPath: string, text: string): ApprovalStatement[] {
  const out: ApprovalStatement[] = [];
  const lines = text.split(/\r?\n/);
  let block: string[] = [];
  let start = 1;
  const flush = () => {
    const t = block.join('\n').trim();
    if (t && (APPROVE_WORD.test(t) || VAGUE_WORD.test(t))) {
      out.push({
        recordPath,
        line: start,
        text: t,
        explicit: APPROVE_WORD.test(t),
        versions: [...new Set([...t.matchAll(/\b(?:v|version\s*)\.?\s*(\d+(?:\.\d+)*)\b/gi)].map((m) => m[1]))],
        filenames: [...new Set([...t.matchAll(/[\p{L}\p{N}_][\p{L}\p{N}_.\-]*\.(?:svg|png|jpe?g|pdf|md|ai|psd|indd|docx?|pptx?)(?![\p{L}\p{N}_])/giu)].map((m) => m[0]))],
        hashes: [...new Set([...t.matchAll(/\b[a-f0-9]{64}\b/gi)].map((m) => m[0].toLowerCase()))],
      });
    }
    block = [];
  };
  lines.forEach((l, i) => {
    if (l.trim() === '') flush();
    else {
      if (block.length === 0) start = i + 1;
      block.push(l);
    }
  });
  flush();
  return out;
}

function versionInName(name: string): string | null {
  const m = /(?:^|[^a-z0-9])v(?:ersion)?[-_ ]?(\d+(?:\.\d+)*)(?![a-z0-9])/i.exec(name.replace(/\.[a-z0-9]+$/i, ''));
  return m ? m[1] : null;
}

function checkApproval(ctx: CheckContext, r: Requirement, p: Extract<AcceptancePredicate, { type: 'approved-version' }>): CheckResult {
  const subject = p.subjectTokens.join(' ');
  const delivered = candidates({ subjectTokens: p.subjectTokens, exactName: p.exactName }, ctx.artifacts.filter((a) => a.inDelivery));
  const statements = ctx.approvalRecords.flatMap((rec) => parseApprovalRecord(rec.path, rec.text));
  const relevant = statements.filter((s) => {
    const hay = tokensOf(s.text + ' ' + s.filenames.join(' '));
    return p.subjectTokens.every((t) => hay.some((h) => h === t || h === t + 's' || h + 's' === t));
  });
  const explicit = relevant.filter((s) => s.explicit && (s.versions.length || s.filenames.length || s.hashes.length));
  const common = {
    ...base(ctx, r, `approval:${subject}`),
    method: 'Compared the delivered file with what the approval record actually identifies (content fingerprint when the record gives one, otherwise the version it names).',
    relatedPaths: [r.sourcePath, ...ctx.approvalRecords.map((a) => a.path), ...delivered.map((a) => a.path)],
  };
  const recEvidence: Evidence[] = relevant.map((s) => ({ kind: 'observed', label: 'Approval record says', detail: s.text, path: s.recordPath, line: s.line }));
  const confirm: RepairSuggestion = { kind: 'confirm-approved-version', action: 'Confirm which approved version belongs in the delivery, then check again.' };

  if (delivered.length === 0)
    return {
      ...common,
      title: `No ${subject} file is in the folder you’re sending.`,
      outcome: ctx.inventoryComplete ? 'not-found-in-scope' : 'unable-to-inspect',
      observed: 'No delivered file matches the subject of this approval requirement.',
      why: 'There is nothing in the delivery to compare with the approval.',
      evidence: [sourceEvidence(r), ...recEvidence],
      inspected: [],
      limitations: ['Matching is by file name.'],
      repair: { kind: 'include-missing-file', action: `Add the approved ${subject} file to the delivery.` },
    };
  if (delivered.length > 1)
    return {
      ...common,
      title: `More than one ${subject} file is in the delivery.`,
      outcome: 'needs-review',
      observed: `Candidates: ${delivered.map((a) => a.path).join(', ')}.`,
      why: 'Sending several versions makes it unclear which one is the approved one.',
      evidence: [sourceEvidence(r), ...recEvidence],
      inspected: delivered.map(inspected),
      limitations: ['Candidates were matched by file name only.'],
      repair: confirm,
    };
  const a = delivered[0];
  if (ctx.approvalRecords.length === 0 || relevant.length === 0)
    return {
      ...common,
      title: `Nothing on record shows ${a.name} was approved.`,
      outcome: 'needs-review',
      observed: ctx.approvalRecords.length === 0 ? 'No approval records were provided.' : 'None of the approval records mentions this document.',
      why: 'Being the latest file does not make it the approved one.',
      evidence: [sourceEvidence(r)],
      inspected: [inspected(a)],
      limitations: ['Loose Ends only reads the approval records you selected.'],
      repair: confirm,
    };
  if (explicit.length === 0)
    return {
      ...common,
      title: `The approval for ${a.name} does not say which version it means.`,
      outcome: 'needs-review',
      observed: 'The record expresses approval but does not identify a version, file name or fingerprint.',
      why: 'A “looks good” note cannot be tied to a specific file, so it does not establish approval of this one.',
      evidence: [sourceEvidence(r), ...recEvidence],
      inspected: [inspected(a)],
      limitations: ['Ambiguous approvals are never treated as approval of the newest file.'],
      repair: confirm,
    };

  const hashes = explicit.flatMap((s) => s.hashes);
  const approvedVersions = [...new Set(explicit.flatMap((s) => [...s.versions, ...s.filenames.map(versionInName).filter((v): v is string => !!v)]))];
  const deliveredVersion = versionInName(a.name);
  const evidence: Evidence[] = [sourceEvidence(r), ...recEvidence];
  const limitations: string[] = ['Loose Ends cannot confirm who wrote the approval record. A fingerprint identifies content; it does not authenticate a signer.'];
  let outcome: CheckOutcome;
  let observed: string;
  let title: string;

  if (hashes.length > 0 && a.sha256) {
    const match = hashes.includes(a.sha256);
    evidence.push({ kind: 'observed', label: 'Delivered file fingerprint', detail: `sha256 ${a.sha256}`, path: a.path });
    evidence.push({ kind: 'observed', label: 'Approved fingerprint', detail: `sha256 ${hashes.join(', ')}` });
    outcome = match ? 'verified' : 'failed';
    observed = match ? 'The delivered file’s content fingerprint equals the one in the approval record.' : 'The delivered file’s content fingerprint differs from the one in the approval record.';
    title = match
      ? `${a.name} is the exact file that was approved.`
      : approvedVersions.length && deliveredVersion && !approvedVersions.includes(deliveredVersion)
        ? `${a.name} is version ${deliveredVersion}, but the approval names version ${approvedVersions.join(' / ')}.`
        : `${a.name} is not the file the approval record identifies.`;
    if (!match) {
      const twin = ctx.artifacts.find((x) => x.sha256 && hashes.includes(x.sha256));
      if (twin) evidence.push({ kind: 'observed', label: 'The approved file exists here', detail: `${twin.path}${twin.inDelivery ? '' : ' (outside the delivery)'}`, path: twin.path });
    }
  } else if (approvedVersions.length > 0 && deliveredVersion) {
    const match = approvedVersions.includes(deliveredVersion);
    outcome = match ? 'verified' : 'failed';
    observed = `Approval names version ${approvedVersions.join(' / ')}; the delivered file name says version ${deliveredVersion}.`;
    title = match ? `${a.name} matches the approved version number.` : `${a.name} is version ${deliveredVersion}, but the approval names version ${approvedVersions.join(' / ')}.`;
    limitations.unshift('Matched by version number in the file name only — weaker than a content fingerprint. An edited file could keep the same name.');
    evidence.push({ kind: 'observed', label: 'Delivered file name', detail: a.name, path: a.path });
  } else {
    outcome = 'needs-review';
    observed = 'The approval identifies a version, but the delivered file carries no version Loose Ends can compare.';
    title = `Cannot tie ${a.name} to the approved version.`;
  }
  if (explicit.length > 1 && approvedVersions.length > 1) limitations.push('Several approvals naming different versions were found; Loose Ends does not assume the most recent one wins.');
  return {
    ...common,
    title,
    outcome,
    observed,
    why:
      outcome === 'verified'
        ? 'The file being sent is the one the approval identifies.'
        : outcome === 'failed'
          ? 'The approval applies to a different version than the one in the delivery. Newer is not the same as approved.'
          : 'Approval cannot be established for this exact file.',
    evidence,
    inspected: [inspected(a)],
    limitations,
    repair: outcome === 'verified' ? NO_REPAIR : confirm,
  };
}

// ---------- recipient boundary ----------

function friendly(a: Artifact): string {
  const n = a.name.toLowerCase();
  if (n.includes('logo')) return 'This logo';
  if (n.includes('icon')) return 'This icon';
  return a.kind === 'markdown' ? 'This document' : 'This graphic';
}

export async function runBoundaryChecks(
  ctx: CheckContext,
  boundaryEnabled: boolean,
  linksEnabled: boolean,
): Promise<{ checks: CheckResult[]; dependencies: Dependency[] }> {
  const checks: CheckResult[] = [];
  const dependencies: Dependency[] = [];
  if (!boundaryEnabled) return { checks, dependencies };
  const delivery = ctx.artifacts.filter((a) => a.inDelivery);
  const rctx: ResolveContext = {
    deliveryPath: ctx.deliveryPath,
    byPath: new Map(ctx.artifacts.map((a) => [a.path, a])),
    allPaths: ctx.artifacts.map((a) => a.path),
    inventoryComplete: ctx.inventoryComplete,
  };
  const req = { id: BOUNDARY_REQUIREMENT_ID };
  const mk = (subject: string) => ({ id: `${req.id}::${subject}`, runId: ctx.runId, requirementId: req.id });
  const builtIn: Evidence = { kind: 'source-excerpt', label: 'Built-in check', detail: 'Everything a delivered file needs in order to display is inside the folder you’re sending.', path: 'Loose Ends built-in check' };
  let inspectedLinkers = 0;
  const selfContained: Artifact[] = [];

  for (const a of delivery) {
    if (a.kind === 'svg' || a.kind === 'markdown') {
      let text: string;
      try {
        text = await ctx.adapter.readText(a.path);
      } catch {
        checks.push(unable(a, 'The file could not be read.'));
        continue;
      }
      if (a.size > LIMITS.maxTextBytes) {
        checks.push(unable(a, 'The file is too large to read in full, so its references could not be listed.'));
        continue;
      }
      const scan = a.kind === 'svg' ? scanSvg(text) : scanMarkdown(text);
      if (!scan.parsed) {
        checks.push(unable(a, 'The file is not well-formed, so its references could not be listed.'));
        continue;
      }
      inspectedLinkers++;
      // Delivered documents are data. Instruction-like lines are recorded and ignored.
      text.split(/\r?\n/).forEach((line, i) => {
        if (INJECTION_RE.test(line))
          ctx.notices.push({ kind: 'untrusted-instruction-ignored', message: 'This line reads like an instruction to the checker. It was ignored: documents cannot change what is scanned or how results are decided.', path: a.path, line: i + 1 });
      });
      const deps = scan.refs.map((raw, i) => resolveReference(a.path, raw, rctx, i));
      dependencies.push(...deps);
      let problems = 0;
      for (const d of deps) {
        if (d.availability === 'included-in-delivery' || d.availability === 'embedded-data') continue;
        if (!d.essential) {
          if (linksEnabled && (d.availability === 'available-outside-delivery' || d.availability === 'missing-in-scope' || d.availability === 'outside-authorized-scope'))
            checks.push({
              id: `${LINKS_REQUIREMENT_ID}::${d.id}`,
              runId: ctx.runId,
              requirementId: LINKS_REQUIREMENT_ID,
              title: `A link in ${a.name} points to a file your client will not receive.`,
              outcome: 'needs-review',
              method: 'Listed the links in the document and resolved each from the document’s own location.',
              observed: `Link “${d.reference}” → ${d.resolvedTarget ?? 'outside the readable folder'} (${availabilityWords(d)}).`,
              why: 'It is a plain link, not something needed to display the document, so this is a suggestion rather than a blocker.',
              evidence: [{ kind: 'observed', label: 'Link as written', detail: d.reference, path: a.path }],
              inspected: [inspected(a)],
              limitations: d.limitations,
              repair: { kind: 'manual-review', action: 'Remove the link or include the linked file, if your client needs it.' },
              relatedPaths: [a.path, ...(d.resolvedTarget ? [d.resolvedTarget] : [])],
            });
          continue;
        }
        problems++;
        const outside = d.availability === 'available-outside-delivery';
        const missing = d.availability === 'missing-in-scope';
        const targetName = (d.resolvedTarget ?? d.reference).split('/').pop()!;
        let repair: RepairSuggestion = {
          kind: outside || missing ? 'include-referenced-asset' : 'manual-review',
          action: outside
            ? `Copy ${d.resolvedTarget} into the delivery and point ${a.name} at the copy, then check again.`
            : missing
              ? `Find ${targetName}, add it to the delivery and update the reference in ${a.name}.`
              : `Check where “${d.reference}” points and make sure your client can reach it.`,
        };
        if (outside && ctx.demoFixes && d.resolvedTarget) {
          const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '';
          const to = joinRel(dir, `assets/${targetName}`);
          repair = {
            ...repair,
            demoFix: {
              id: `include:${d.id}`,
              description: `Copies ${d.resolvedTarget} to ${to} and rewrites the reference in ${a.path} from “${d.reference}” to “assets/${encodeURI(targetName)}”.`,
              operations: [
                { op: 'copy', from: d.resolvedTarget, to },
                { op: 'rewrite-reference', file: a.path, from: d.reference, to: `assets/${encodeURI(targetName)}` },
              ],
            },
          };
        }
        const target = d.resolvedTarget ? rctx.byPath.get(d.resolvedTarget) : undefined;
        checks.push({
          ...mk(d.id),
          title: outside
            ? `${friendly(a)} uses an image outside the folder you’re sending.`
            : missing
              ? `${friendly(a)} uses an image that cannot be found.`
              : `${friendly(a)} uses an image Loose Ends cannot account for.`,
          outcome: outside || missing ? 'failed' : 'needs-review',
          method: 'Read the file’s own contents, listed the images it pulls in, and resolved each one from the file’s location against the delivery folder.',
          observed: `${a.path} contains the reference “${d.reference}”. ${
            outside
              ? `It resolves to ${d.resolvedTarget}, which exists but sits outside ${ctx.deliveryPath || 'the delivery folder'}.`
              : missing
                ? `It resolves to ${d.resolvedTarget}, and no file exists there.`
                : availabilityWords(d) + '.'
          }`,
          why: outside
            ? 'If you send only the delivery folder, this image stays behind and the file will show a gap where it should be.'
            : missing
              ? 'The file points at an image that is not there, so it will show a gap.'
              : 'Loose Ends cannot tell whether your client will be able to load this image.',
          evidence: [
            builtIn,
            { kind: 'observed', label: 'Reference as written', detail: d.reference, path: a.path },
            { kind: 'observed', label: 'Resolves to', detail: d.resolvedTarget ?? 'not resolvable inside the readable folder' },
            { kind: 'observed', label: 'Delivery folder', detail: ctx.deliveryPath || '(the selected folder)' },
          ],
          inspected: [inspected(a), ...(target ? [inspected(target)] : [])],
          limitations: [
            'This is a file-boundary finding: it shows what would and would not travel with the folder. It is not a test of your client’s software.',
            ...d.limitations,
            ...(scan.unsupported.length ? [`Not analysed in this file: ${scan.unsupported.join('; ')}.`] : []),
          ],
          repair,
          groupKey: d.resolvedTarget ?? undefined,
          relatedPaths: [a.path, ...(d.resolvedTarget ? [d.resolvedTarget] : [])],
        });
      }
      if (scan.unsupported.length > 0) {
        ctx.gaps.push({ kind: 'unsupported-reference', path: a.path, reason: `Contains ${scan.unsupported.join('; ')}, which Loose Ends does not analyse.` });
        checks.push({
          ...mk(`unsupported:${a.path}`),
          title: `${a.name} uses a kind of link Loose Ends cannot follow.`,
          outcome: 'needs-review',
          method: 'Scanned the file for reference syntax.',
          observed: `Found: ${scan.unsupported.join('; ')}.`,
          why: 'These may pull in other files. Loose Ends does not analyse them, so coverage of this file is incomplete.',
          evidence: [builtIn],
          inspected: [inspected(a)],
          limitations: ['Only image href / xlink:href and Markdown image/link references are analysed.'],
          repair: { kind: 'manual-review', action: `Open ${a.name} and confirm it does not depend on files outside the delivery.` },
          relatedPaths: [a.path],
        });
      } else if (problems === 0) {
        const essential = deps.filter((d) => d.essential).length;
        checks.push({
          ...mk(`ok:${a.path}`),
          title: essential ? `Everything ${a.name} pulls in is inside the delivery.` : `${a.name} does not pull in any other files.`,
          outcome: 'verified',
          method: 'Read the file’s contents and resolved each image reference against the delivery folder.',
          observed: `${essential} image ${essential === 1 ? 'reference' : 'references'}; all inside the delivery or embedded.`,
          why: 'Nothing this file needs would be left behind.',
          evidence: [builtIn, ...deps.filter((d) => d.essential).map((d): Evidence => ({ kind: 'observed', label: 'Reference', detail: `${d.reference} → ${d.resolvedTarget ?? 'embedded'}`, path: a.path }))],
          inspected: [inspected(a)],
          limitations: ['Covers image href / xlink:href and Markdown image references only. Not a test of your client’s software.'],
          repair: NO_REPAIR,
          relatedPaths: [a.path, ...deps.map((d) => d.resolvedTarget).filter((x): x is string => !!x)],
        });
      }
    } else if (SELF_CONTAINED.has(a.kind)) {
      selfContained.push(a);
    } else {
      ctx.gaps.push({ kind: 'unsupported-format', path: a.path, reason: `Loose Ends cannot look inside .${a.extension || 'unknown'} files.` });
      checks.push({
        ...mk(`unsupported-format:${a.path}`),
        title: `Loose Ends cannot look inside ${a.name}.`,
        outcome: 'unable-to-inspect',
        method: 'Detected the file type from its contents.',
        observed: `Type not recognised (extension .${a.extension || 'none'}). Source formats like this can link to fonts, images or other files.`,
        why: 'If this file depends on things outside the delivery, Loose Ends would not know. It cannot be counted as checked.',
        evidence: [builtIn, { kind: 'observed', label: 'Detected type', detail: a.kind, path: a.path }],
        inspected: [inspected(a)],
        limitations: ['No claim is made about whether this file opens or is editable.'],
        repair: { kind: 'manual-review', action: `Open ${a.name} yourself and confirm its linked files and fonts are packaged with it.` },
        relatedPaths: [a.path],
      });
    }
  }

  function unable(a: Artifact, reason: string): CheckResult {
    ctx.gaps.push({ kind: 'unreadable', path: a.path, reason });
    return {
      ...mk(`unreadable:${a.path}`),
      title: `${a.name} could not be inspected.`,
      outcome: 'unable-to-inspect',
      method: 'Tried to read the file and list its references.',
      observed: reason,
      why: 'A file that cannot be read cannot be counted as checked.',
      evidence: [builtIn],
      inspected: [inspected(a)],
      limitations: ['No references from this file were analysed.'],
      repair: { kind: 'fix-file', action: `Re-export ${a.name}; it may be damaged.` },
      relatedPaths: [a.path],
    };
  }

  if (selfContained.length > 0 || inspectedLinkers === 0) {
    checks.push({
      ...mk('self-contained'),
      title: delivery.length === 0 ? 'The folder you’re sending is empty.' : `${selfContained.length} delivered ${selfContained.length === 1 ? 'file is' : 'files are'} of a kind that carries its own content.`,
      outcome: delivery.length === 0 ? 'needs-review' : 'verified',
      method: 'Detected each file’s type from its contents.',
      observed: delivery.length === 0 ? 'No files in the delivery.' : `Images, PDFs and plain text: ${selfContained.map((a) => a.name).slice(0, 12).join(', ')}${selfContained.length > 12 ? '…' : ''}.`,
      why: delivery.length === 0 ? 'There is nothing to send.' : 'These formats normally do not depend on other files.',
      evidence: [builtIn],
      inspected: selfContained.slice(0, 50).map(inspected),
      limitations: ['PDFs can, rarely, link to outside files; PDF internals are not inspected.'],
      repair: NO_REPAIR,
      relatedPaths: selfContained.map((a) => a.path),
    });
  }
  return { checks, dependencies };
}

function availabilityWords(d: Dependency): string {
  switch (d.availability) {
    case 'included-in-delivery':
      return 'inside the delivery';
    case 'available-outside-delivery':
      return 'exists, but outside the delivery';
    case 'missing-in-scope':
      return 'no file at that location';
    case 'outside-authorized-scope':
      return 'points outside the folder Loose Ends may read';
    case 'embedded-data':
      return 'embedded in the file';
    case 'cannot-establish':
      return 'availability cannot be established';
  }
}
