// Turns a brief into atomic, checkable commitments with provenance.
// This is a deterministic rule-based reader — it is NOT AI extraction and is
// labelled "rule-based" everywhere. Brief text is treated as untrusted data:
// it can produce requirements, never instructions for the checker.
import { createHash } from 'node:crypto';
import type { AcceptancePredicate, Applicability, AuthorityStatus, Notice, Requirement, RequirementOrigin, ScopeSource } from '../domain/model.ts';

const FILE_EXT = 'svg|png|jpe?g|gif|webp|pdf|md|txt|ai|psd|indd|eps|fig|sketch|docx?|pptx?|key|zip|mp4|mov|otf|ttf';
// Letters and digits in any script: a file called lumière-logo.svg or Größe.png is one name, not two.
const FILENAME_RE = new RegExp(`(?:\`([^\`\\n]+?\\.(?:${FILE_EXT}))\`|(?<![\\p{L}\\p{N}_/.-])([\\p{L}\\p{N}_][\\p{L}\\p{N}_.\\-]*\\.(?:${FILE_EXT}))(?![\\p{L}\\p{N}_-]))`, 'giu');
const DIM_RE = /(\d{2,5})\s*(?:x|×|by)\s*(\d{2,5})/i;
export const INJECTION_RE =
  /\b(ignore (all |any |the )?(previous|prior|above|other) (instructions|rules|checks)|disregard (all|the|any) (instructions|rules|checks)|mark (everything|all|this|every)[^.]{0,40}\b(verified|passed|ready|approved)|skip (all |the )?(checks|verification)|you are (now )?(an?|the) |system prompt|as an ai|scan (the )?(entire|whole) (disk|drive|computer|system)|read (\/etc|~\/|\/users|c:\\)|override (the )?(checker|rules|scoring)|report (that )?(everything|all) (is|as) (ready|verified|fine))/i;
const OPTIONAL_RE = /\b(optional(ly)?|nice[- ]to[- ]have|if (time|budget) (permits|allows)|would be (welcome|appreciated)|bonus|may (also )?(include|send|add)|feel free|would be (nice|great)|not required|stretch)\b/i;
const CONDITIONAL_RE = /(^|[,;]\s*)(if|only if|unless|when|in case|provided that)\b\s+([^,.;]+)/i;
const REQUIRED_RE = /\b(must|shall|required?|requires|needs? to|have to|has to|deliver|include[sd]?|provide|send|supply|should|is due|are due|expects?|we promised|promised|you(?:'|’)?(?:ll| will) (?:get|receive|have)|we(?:'|’)?(?:ll| will) (?:send|deliver|supply|provide|hand over)|comes? as|don(?:'|’)?t forget|remember to|counting on|as agreed)\b/i;
const APPROVAL_RE = /\b(approved|approval|signed[- ]off|sign[- ]off)\b/i;
const BOUNDARY_RE =
  /(self[- ]contained|no (external|outside|broken|missing) (references|links|linked files|dependencies)|not (reference|link to|depend on|use) (any ?thing|files?|images?|assets?) outside|(linked|referenced|embedded|placed) (assets?|files?|images?) (must |should |need to )?(all )?(be )?(included|inside|travel)|everything (it|they) (references?|links?|uses?) (must|should))/i;

const STOP = new Set(
  'a an the of in on at to for and or as is are be with by from this that these those it its our your their we you they client final file files version variant variants format formats must shall should required require requires need needs deliver delivered include included includes provide provided send supply please also all any each every one two three both only if when unless optional optionally nice have has px pixels pixel sized size at exactly approved approval signed off copy latest named called export exported image images asset assets document doc agreed ll get gets comes come well too would could really help re ve don forget remember sure counting handover vector there here just like love us'.split(
    ' ',
  ),
);
const EXT_WORDS = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'md', 'markdown', 'ai', 'psd', 'eps']);

export function requirementId(sourcePath: string, text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return 'REQ-' + createHash('sha1').update(`${sourcePath}|${norm}`).digest('hex').slice(0, 8);
}

export function tokensOf(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w) && !EXT_WORDS.has(w) && !/^\d+$/.test(w) && !/^v\d+$/.test(w));
}

export function subjectKeyOf(p: AcceptancePredicate): string {
  switch (p.type) {
    case 'file-included':
    case 'image-dimensions':
      return `artifact:${p.exactName?.toLowerCase() ?? [...p.nameTokens].sort().join('+')}:${p.type === 'image-dimensions' ? 'dimensions' : 'presence'}`;
    case 'approved-version':
      return `approval:${p.exactName?.toLowerCase() ?? [...p.subjectTokens].sort().join('+')}`;
    case 'references-resolve':
      return 'boundary';
    case 'manual':
      return `manual:${createHash('sha1').update(p.description.toLowerCase()).digest('hex').slice(0, 8)}`;
  }
}

export function derivePredicate(line: string): AcceptancePredicate {
  const names: string[] = [];
  const stripped = line.replace(FILENAME_RE, (_m, a, b) => {
    names.push((a ?? b).trim());
    return ' ';
  });
  const exactName = names[0];
  const exts = [...new Set((stripped.toLowerCase().match(/\b(svg|png|jpe?g|gif|webp|pdf)\b/g) ?? []).map((e) => (e === 'jpeg' ? 'jpg' : e)))];
  const nameTokens = tokensOf(stripped).slice(0, 4);

  if (BOUNDARY_RE.test(line)) return { type: 'references-resolve' };
  if (APPROVAL_RE.test(line)) {
    const subjectTokens = exactName ? tokensOf(exactName.replace(/\.[a-z0-9]+$/i, '')) : nameTokens.slice(0, 3);
    if (subjectTokens.length > 0) return { type: 'approved-version', subjectTokens, ...(exactName ? { exactName } : {}) };
  }
  const dim = DIM_RE.exec(stripped);
  if (dim && (exactName || nameTokens.length > 0))
    return { type: 'image-dimensions', ...(exactName ? { exactName } : {}), nameTokens, extensions: exts, width: Number(dim[1]), height: Number(dim[2]) };
  // A sentence that names several files promises all of them, not just the first.
  if (names.length > 1) return { type: 'file-included', exactName, exactNames: [...new Set(names)].slice(0, MAX_NAMES_PER_LINE), nameTokens: nameTokens.slice(0, 12), extensions: exts };
  if (exactName) return { type: 'file-included', exactName, nameTokens, extensions: exts };
  if (nameTokens.length >= 1 && exts.length > 0) return { type: 'file-included', nameTokens, extensions: exts };
  return { type: 'manual', description: line.trim() };
}

export interface ExtractionResult {
  requirements: Requirement[];
  notices: Notice[];
}

/** A single line longer than this is not a sentence a person wrote as a promise; it is skipped and reported. */
export const MAX_LINE_CHARS = 2000;
const MAX_NAMES_PER_LINE = 40;

/** True when a "document" is not text: null bytes, or more than a few undecodable characters. */
export function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true;
  const bad = (text.match(/\uFFFD/g) ?? []).length;
  return bad > 3 && bad / Math.max(1, text.length) > 0.01;
}

/** Rule-based reading of one brief document. */
export function extractFromBrief(text: string, source: { id: string; path: string }, origin: RequirementOrigin = 'rule-based'): ExtractionResult {
  const requirements: Requirement[] = [];
  const notices: Notice[] = [];
  const lines = text.split(/\r?\n/);
  let sectionMode: Applicability | null = null;
  let inFence = false;
  const seen = new Set<string>();

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (rawLine.length > MAX_LINE_CHARS) {
      notices.push({ kind: 'info', path: source.path, line: lineNo, message: `Line ${lineNo} of ${source.path} is ${rawLine.length.toLocaleString('en-US')} characters long and was not read. If it contains a promise, add it by hand.` });
      return;
    }
    // A heading is a Markdown heading, or a short plain line that ends with a colon ("Must have:", "Nice to have:").
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(rawLine) ?? /^\s{0,3}(?![-*+]\s|\d+[.)]\s)([^\n]{1,40}):\s*$/.exec(rawLine);
    if (heading) {
      const h = heading[1].toLowerCase();
      if (OPTIONAL_RE.test(h) || /\b(extras?|wishlist)\b/.test(h)) sectionMode = 'optional';
      else if (/\b(deliverables?|requirements?|required|must[- ]haves?|what we need|scope|specs?|specifications?)\b/.test(h)) sectionMode = 'required';
      else if (/:\s*$/.test(rawLine) && !/^\s{0,3}#/.test(rawLine)) return; // an unrelated label line leaves the current section as it is
      else sectionMode = null;
      return;
    }
    const isListItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(rawLine);
    const line = rawLine.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\s*>\s?/, '').trim();
    if (!line || /^\|?[-:| ]+\|?$/.test(line)) return;

    if (INJECTION_RE.test(line)) {
      notices.push({
        kind: 'untrusted-instruction-ignored',
        message: 'This line reads like an instruction to the checker. It was ignored: documents cannot change what is scanned or how results are decided.',
        path: source.path,
        line: lineNo,
      });
      return;
    }

    let applicability: Applicability | null = null;
    let condition: string | undefined;
    const cond = CONDITIONAL_RE.exec(line);
    if (OPTIONAL_RE.test(line)) applicability = 'optional';
    else if (cond && REQUIRED_RE.test(line)) {
      applicability = 'conditional';
      condition = `${cond[2]} ${cond[3]}`.trim();
    } else if (REQUIRED_RE.test(line)) applicability = sectionMode === 'optional' ? 'optional' : 'required';
    else if (isListItem && sectionMode) applicability = sectionMode;
    const predicate = derivePredicate(line);
    // A list item that names a file, a format or a size is a deliverable even without a verb or a recognised heading.
    // Missing a promise is worse than proposing one too many: the person can untick it, but cannot see what was never read.
    if (!applicability && isListItem && predicate.type !== 'manual') applicability = 'required';
    // So is any sentence that names a file outright ("Final files: a.svg, b.svg", "The notes go in README.md").
    if (!applicability && 'exactName' in predicate && predicate.exactName) applicability = 'required';
    if (!applicability) return;

    // A sentence that is not a list item and maps to nothing checkable is prose, not a commitment.
    if (predicate.type === 'manual' && !isListItem) return;
    const id = requirementId(source.path, line);
    if (seen.has(id)) return;
    seen.add(id);
    requirements.push({
      id,
      text: line,
      sourceId: source.id,
      sourcePath: source.path,
      excerpt: line,
      location: { line: lineNo },
      predicate,
      applicability,
      ...(condition ? { condition } : {}),
      authority: 'authoritative',
      origin,
      subjectKey: subjectKeyOf(predicate),
      enabled: true,
    });
  });
  return { requirements, notices };
}

export const BOUNDARY_REQUIREMENT_ID = 'REQ-boundary';
export const LINKS_REQUIREMENT_ID = 'REQ-links';

/** Built-in check that is the point of the product; shown with its own provenance, never attributed to the brief. */
export function builtInRequirements(): Requirement[] {
  return [
    {
      id: BOUNDARY_REQUIREMENT_ID,
      text: 'Everything a delivered file needs in order to display is inside the folder you’re sending.',
      sourceId: 'built-in',
      sourcePath: 'Loose Ends built-in check',
      excerpt: 'Built-in file-boundary check (“What your client gets”). Not taken from the brief.',
      location: null,
      predicate: { type: 'references-resolve' },
      applicability: 'required',
      authority: 'authoritative',
      origin: 'built-in',
      subjectKey: 'boundary',
      enabled: true,
    },
    {
      id: LINKS_REQUIREMENT_ID,
      text: 'Links in delivered documents point to things your client can reach.',
      sourceId: 'built-in',
      sourcePath: 'Loose Ends built-in check',
      excerpt: 'Built-in suggestion. Informational links are not treated as required assets.',
      location: null,
      predicate: { type: 'references-resolve' },
      applicability: 'suggestion',
      authority: 'authoritative',
      origin: 'built-in',
      subjectKey: 'links',
      enabled: true,
    },
  ];
}

export interface AuthorityQuestion {
  subjectKey: string;
  question: string;
  options: { sourcePath: string; requirementId: string; text: string }[];
}

function predicateValue(p: AcceptancePredicate): string {
  const { ...rest } = p as Record<string, unknown>;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/**
 * Source authority. A newer timestamp never decides anything. Conflicts between
 * briefs are resolved only by (a) an explicit user decision, or (b) an approval
 * record that explicitly approves the superseding document by name.
 */
export function resolveAuthority(
  requirements: Requirement[],
  decisions: Record<string, string>,
  approvalTexts: { path: string; text: string }[],
): { requirements: Requirement[]; questions: AuthorityQuestion[]; sourceAuthority: Map<string, { status: AuthorityStatus; basis: string }> } {
  const out = requirements.map((r) => ({ ...r }));
  const questions: AuthorityQuestion[] = [];
  const sourceAuthority = new Map<string, { status: AuthorityStatus; basis: string }>();
  const bySubject = new Map<string, Requirement[]>();
  for (const r of out) {
    if (r.origin === 'built-in' || !r.enabled) continue;
    const list = bySubject.get(r.subjectKey) ?? [];
    list.push(r);
    bySubject.set(r.subjectKey, list);
  }
  for (const [subjectKey, group] of bySubject) {
    const sources = new Set(group.map((r) => r.sourcePath));
    const values = new Set(group.map((r) => `${predicateValue(r.predicate)}|${r.applicability}`));
    if (sources.size < 2 || values.size < 2) continue;
    let chosen = decisions[subjectKey] ?? decisions['*'];
    let basis = 'You chose which document to follow.';
    if (!chosen || !sources.has(chosen)) {
      chosen = '';
      for (const src of sources) {
        const base = src.split('/').pop()!.toLowerCase();
        const approved = approvalTexts.find((a) => a.text.split(/\n\s*\n/).some((block) => APPROVAL_RE.test(block) && block.toLowerCase().includes(base) && /supersed|replac|amend/i.test(block)));
        if (approved) {
          chosen = src;
          basis = `An approval record (${approved.path}) explicitly approves ${base} as the superseding document.`;
          break;
        }
      }
    }
    for (const r of group) {
      if (chosen) {
        r.authority = r.sourcePath === chosen ? 'authoritative' : 'superseded';
        sourceAuthority.set(r.sourcePath, { status: r.authority, basis });
      } else {
        r.authority = 'conflicting';
        sourceAuthority.set(r.sourcePath, { status: 'conflicting', basis: 'Two documents disagree and nothing establishes which one wins.' });
      }
    }
    if (!chosen)
      questions.push({
        subjectKey,
        question: `Two documents disagree about the same deliverable. Which one should Loose Ends follow?`,
        options: group.map((r) => ({ sourcePath: r.sourcePath, requirementId: r.id, text: r.text })),
      });
  }
  return { requirements: out, questions, sourceAuthority };
}

export function buildSources(
  briefs: { path: string; sha256: string | null }[],
  approvals: { path: string; sha256: string | null }[],
  sourceAuthority: Map<string, { status: AuthorityStatus; basis: string }>,
): ScopeSource[] {
  return [
    ...briefs.map((b): ScopeSource => {
      const a = sourceAuthority.get(b.path);
      return {
        id: b.path,
        path: b.path,
        role: 'brief',
        sha256: b.sha256,
        authority: a?.status ?? 'authoritative',
        authorityBasis: a?.basis ?? (briefs.length === 1 ? 'The only brief you selected.' : 'Selected by you; no conflict with the other brief documents.'),
      };
    }),
    ...approvals.map(
      (b): ScopeSource => ({ id: b.path, path: b.path, role: 'approval-record', sha256: b.sha256, authority: 'unconfirmed', authorityBasis: 'Approval record you selected. Loose Ends cannot confirm who wrote it.' }),
    ),
  ];
}
