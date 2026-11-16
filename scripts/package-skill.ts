// Builds the Skill ZIP from an explicit allowlist and validates it.
// Usage: npx tsx scripts/package-skill.ts [outDir=release/checkpoint-1]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const skillDir = path.join(root, 'skill', 'loose-ends');
const outDir = path.resolve(root, process.argv[2] ?? 'release/checkpoint-1');
const zipPath = path.join(outDir, 'loose-ends-skill.zip');
const LIMIT_TOTAL = 10_000_000, LIMIT_FILE = 1_000_000, LIMIT_COUNT = 100;

const lines: string[] = [];
let failed = false;
const check = (ok: boolean, label: string, detail = '') => {
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed = true;
};

// --- allowlist: SKILL.md + references/*.md only
const refDir = path.join(skillDir, 'references');
const refFiles = fs.existsSync(refDir) ? fs.readdirSync(refDir).sort() : [];
const allow = ['SKILL.md', ...refFiles.filter((f) => f.endsWith('.md')).map((f) => `references/${f}`)];
const nonMd = refFiles.filter((f) => !f.endsWith('.md'));
check(nonMd.length === 0, 'references/ contains only .md files', nonMd.join(', '));
const stray = fs.readdirSync(skillDir).filter((f) => f !== 'SKILL.md' && f !== 'references');
lines.push(`INFO  files in skill/loose-ends not on the allowlist (excluded from ZIP): ${stray.join(', ') || 'none'}`);

// --- frontmatter
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
check(!!fm, 'SKILL.md starts with YAML frontmatter');
const field = (k: string) => new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(fm?.[1] ?? '')?.[1]?.trim() ?? '';
const name = field('name'), description = field('description');
check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && name.length >= 2 && name.length <= 64, 'name is lowercase hyphenated, 2–64 chars', `"${name}" (${name.length})`);
check(name === 'loose-ends', 'name is loose-ends');
check(description.length > 0 && description.length <= 1024, 'description ≤ 1,024 characters', `${description.length} chars`);
const fmKeys = (fm?.[1] ?? '').split('\n').filter((l) => /^\w+:/.test(l)).map((l) => l.split(':')[0]);
check(fmKeys.join(',') === 'name,description', 'frontmatter has exactly name, description', fmKeys.join(','));

// --- links
const linked = new Set<string>();
for (const m of skill.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
  if (!/^[a-z]+:/i.test(m[1])) linked.add(path.posix.normalize(m[1]));
}
for (const l of linked) check(allow.includes(l), `linked file exists and is allowed: ${l}`);
for (const r of allow.slice(1)) check(linked.has(r), `reference is directly linked from SKILL.md: ${r}`);
for (const r of allow.slice(1)) {
  const body = fs.readFileSync(path.join(skillDir, r), 'utf8');
  for (const m of body.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    if (/^https?:/i.test(m[1])) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(r), m[1]));
    check(allow.includes(target), `link inside ${r} resolves within package: ${m[1]}`);
  }
}

// --- content checks
for (const f of allow) {
  const body = fs.readFileSync(path.join(skillDir, f), 'utf8');
  const size = Buffer.byteLength(body);
  check(size < LIMIT_FILE, `${f} under 1,000,000 bytes`, `${size} bytes`);
  check(!/\b(TODO|TBD|FIXME|lorem ipsum)\b/i.test(body), `${f} has no TODO/TBD/placeholder text`);
  check(!/(api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}/i.test(body) && !/sk-[A-Za-z0-9]{16,}/.test(body), `${f} has no credential-like strings`);
}
check(allow.length <= LIMIT_COUNT, 'file count ≤ 100', `${allow.length} files`);

// --- build
fs.mkdirSync(outDir, { recursive: true });
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'loose-ends-skill-'));
const top = path.join(stage, 'loose-ends');
for (const f of allow) {
  fs.mkdirSync(path.dirname(path.join(top, f)), { recursive: true });
  fs.copyFileSync(path.join(skillDir, f), path.join(top, f));
}
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-X', '-q', zipPath, ...allow.map((f) => `loose-ends/${f}`)], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });

// --- verify the built ZIP
let integrity = '';
try { integrity = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' }); } catch (e: any) { integrity = String(e.stdout ?? e); }
check(/No errors detected/.test(integrity), 'unzip -t integrity');
const listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n');
const expected = allow.map((f) => `loose-ends/${f}`);
check(JSON.stringify([...listing].sort()) === JSON.stringify([...expected].sort()), 'ZIP entries equal the allowlist exactly', listing.join(', '));
check(listing.every((e) => e.startsWith('loose-ends/') && e.endsWith('.md')), 'root layout: single loose-ends/ folder, Markdown only');
const zipSize = fs.statSync(zipPath).size;
const unc = allow.reduce((n, f) => n + fs.statSync(path.join(skillDir, f)).size, 0);
check(zipSize < LIMIT_TOTAL, 'compressed total under 10,000,000 bytes', `${zipSize} bytes`);
check(unc < LIMIT_TOTAL, 'uncompressed total under 10,000,000 bytes', `${unc} bytes`);

const report = [
  'Loose Ends — Skill package validation',
  `Built: ${new Date().toISOString()}`,
  `ZIP: ${path.relative(root, zipPath)} (${zipSize} bytes compressed, ${unc} bytes uncompressed, ${allow.length} files)`,
  '',
  ...lines,
  '',
  failed ? 'RESULT: FAIL' : 'RESULT: PASS (local format checks only)',
  'OFFICIAL STATIC CHECK: run separately with the bundled checker from uliya-skill-kit 0.7.7; result saved next to this file as official-check.json. Nothing has been executed on a UGREEN NAS.',
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, 'skill-validation.txt'), report);
console.log(report);
process.exit(failed ? 1 : 0);
