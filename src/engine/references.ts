// Reference discovery and file-boundary resolution ("What your client gets").
// Nothing here opens a reference target or fetches a URL: targets are looked up
// in the inventory of the authorized folder only.
import path from 'node:path';
import type { Artifact, Dependency, DependencyAvailability } from '../domain/model.ts';
import { isInside } from './adapter.ts';

export interface RawReference {
  reference: string;
  referenceType: Dependency['referenceType'];
  essential: boolean;
}

export interface ScanResult {
  refs: RawReference[];
  parsed: boolean; // false when the file could not be parsed as its format
  unsupported: string[]; // syntax we saw but do not analyse (incomplete coverage)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d{1,7});/g, (m, n) => codePoint(Number(n), m))
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, n) => codePoint(parseInt(n, 16), m));
}

/** An out-of-range character reference is left as written instead of throwing. */
function codePoint(n: number, original: string): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : original;
}

export function scanSvg(text: string): ScanResult {
  const unsupported: string[] = [];
  if (!/<svg[\s>]/i.test(text) || !(/<\/svg\s{0,20}>/i.test(text) || /<svg[^>]{0,4000}\/>/i.test(text))) return { refs: [], parsed: false, unsupported };
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  const refs: RawReference[] = [];
  // The tag's end is found with indexOf rather than a pattern, so many unclosed "<image" openers cannot make the scan quadratic.
  const tagRe = /<(?:image|feImage|use)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(body))) {
    const end = body.indexOf('>', tagRe.lastIndex);
    if (end === -1) break;
    const attrs = body.slice(tagRe.lastIndex, end);
    tagRe.lastIndex = end + 1;
    const attrRe = /(?:^|\s)(?:xlink:href|href)\s{0,20}=\s{0,20}(?:"([^"]*)"|'([^']*)')/gi;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(attrs))) {
      const value = decodeEntities((a[1] ?? a[2] ?? '').trim());
      if (!value || value.startsWith('#')) continue;
      refs.push({ reference: value, referenceType: 'svg-image-href', essential: true });
    }
  }
  if (/url\(\s*['"]?(?!#|data:)[^)'"]+/i.test(body)) unsupported.push('CSS url(...) pointing at another file');
  if (/@import/i.test(body)) unsupported.push('CSS @import');
  if (/<script[\s>]/i.test(body)) unsupported.push('embedded script (never executed by Loose Ends)');
  if (/<foreignObject[\s>]/i.test(body)) unsupported.push('embedded HTML (foreignObject)');
  if (/<\?xml-stylesheet/i.test(text)) unsupported.push('external stylesheet');
  return { refs, parsed: true, unsupported };
}

export function scanMarkdown(text: string): ScanResult {
  const unsupported: string[] = [];
  // Drop fenced and inline code so examples are not treated as references.
  const body = text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '');
  const refs: RawReference[] = [];
  // Every repetition is bounded: unbounded ones made a crafted file (100,000 "[" in a row) take minutes, blocking the whole service.
  const re = /(!?)\[(?:[^\]\\]|\\.){0,1000}\]\(\s{0,100}(?:<([^>\n]{1,2000})>|([^)\s]{1,2000}))(?:\s{1,100}(?:"[^"\n]{0,1000}"|'[^'\n]{0,1000}'))?\s{0,100}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const target = (m[2] ?? m[3] ?? '').trim();
    if (!target || target.startsWith('#')) continue;
    refs.push({ reference: target, referenceType: m[1] ? 'markdown-image' : 'markdown-link', essential: Boolean(m[1]) });
  }
  const imgRe = /<img\b[^>]{0,2000}?\ssrc\s{0,20}=\s{0,20}(?:"([^"]{0,2000})"|'([^']{0,2000})')/gi;
  while ((m = imgRe.exec(body))) {
    const target = (m[1] ?? m[2] ?? '').trim();
    if (target) refs.push({ reference: decodeEntities(target), referenceType: 'markdown-image', essential: true });
  }
  if (/^[ \t]{0,3}\[[^\]\n]{1,500}\]:[ \t]*\S/m.test(body)) unsupported.push('reference-style link definitions');
  return { refs, parsed: true, unsupported };
}

export interface ResolveContext {
  deliveryPath: string;
  byPath: Map<string, Artifact>;
  allPaths: string[];
  inventoryComplete: boolean;
}

/** Resolves one reference relative to its containing file and classifies it against the delivery boundary. */
export function resolveReference(sourcePath: string, raw: RawReference, ctx: ResolveContext, index: number): Dependency {
  const base: Omit<Dependency, 'availability' | 'resolvedTarget' | 'limitations'> = {
    id: `${sourcePath}#${index}`,
    sourcePath,
    reference: raw.reference,
    referenceType: raw.referenceType,
    essential: raw.essential,
  };
  const done = (availability: DependencyAvailability, resolvedTarget: string | null, limitations: string[]): Dependency => ({
    ...base,
    availability,
    resolvedTarget,
    limitations,
  });
  const ref = raw.reference.trim();
  if (/^data:/i.test(ref)) return done('embedded-data', null, ['Embedded directly in the file; nothing extra to send.']);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) || ref.startsWith('//'))
    return done('cannot-establish', null, ['Points to a web address or another kind of link. Loose Ends does not fetch it, so it cannot say whether your client can reach it.']);
  if (ref.startsWith('/') || ref.startsWith('\\'))
    return done('cannot-establish', null, ['Uses an absolute path that only makes sense on one computer. It was not opened.']);

  let decoded = ref.replace(/[?#].*$/, '').replace(/\\/g, '/');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return done('cannot-establish', null, ['The reference is not validly encoded, so its target could not be worked out.']);
  }
  if (!decoded) return done('cannot-establish', null, ['Empty reference.']);
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), decoded)).replace(/\/$/, '');
  if (joined === '..' || joined.startsWith('../'))
    return done('outside-authorized-scope', null, ['Points outside the folder Loose Ends was allowed to read. The target was not opened and will not travel with the delivery.']);

  const artifact = ctx.byPath.get(joined);
  const isDir = !artifact && ctx.allPaths.some((p) => p.startsWith(joined + '/'));
  if (!artifact && !isDir) {
    if (!ctx.inventoryComplete) return done('cannot-establish', joined, ['The folder scan was incomplete, so a missing target cannot be confirmed.']);
    return done('missing-in-scope', joined, ['No file exists at this location in the folder Loose Ends was allowed to read.']);
  }
  const limitations = ['Shows where the file sits relative to the folder being sent. It does not prove your client’s software can open it.'];
  if (isInside(ctx.deliveryPath, joined)) return done('included-in-delivery', joined, limitations);
  return done('available-outside-delivery', joined, limitations);
}

/** Paths reachable from `start` through dependency records. Cycle-safe. */
export function reachable(start: string, deps: Dependency[]): string[] {
  const edges = new Map<string, string[]>();
  for (const d of deps) {
    if (!d.resolvedTarget) continue;
    const list = edges.get(d.sourcePath) ?? [];
    list.push(d.resolvedTarget);
    edges.set(d.sourcePath, list);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of edges.get(cur) ?? []) {
      if (next === start || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return [...seen];
}
