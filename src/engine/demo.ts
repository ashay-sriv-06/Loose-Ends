// "Apply demo fix": real file operations, only inside a synthetic fixture root.
// Never edits finding statuses — the next run has to observe the change.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DemoOperation } from '../domain/model.ts';
import { normalizeRel, type AuthorizedRoot } from './adapter.ts';
import { FIXTURE_MARKER } from '../fixture/build.ts';

export async function applyDemoOperations(root: AuthorizedRoot, operations: DemoOperation[]): Promise<string[]> {
  if (root.kind !== 'synthetic-fixture') throw new Error('Demo fixes are only available for the synthetic demo folder. Your own files are never modified.');
  await fs.access(path.join(root.absPath, FIXTURE_MARKER)).catch(() => {
    throw new Error('Refusing to write: the folder is not marked as a Loose Ends fixture.');
  });
  const rootReal = await fs.realpath(root.absPath);
  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + path.sep);
  /** Resolves a path for reading or writing and proves that neither it nor its parent folder leads out through a symlink. */
  const abs = async (rel: string, mode: 'read' | 'write'): Promise<string> => {
    const p = path.join(rootReal, normalizeRel(rel));
    if (!inside(p) || p === rootReal) throw new Error('Refusing to touch anything outside the demo folder.');
    // Nearest existing ancestor must really be inside the demo folder.
    let dir = path.dirname(p);
    for (;;) {
      try {
        if (!inside(await fs.realpath(dir))) throw new Error('Refusing: a shortcut (symlink) in the demo folder leads outside it.');
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        dir = path.dirname(dir);
      }
    }
    const st = await fs.lstat(p).catch(() => null);
    if (st?.isSymbolicLink()) throw new Error('Refusing: this path is a shortcut (symlink).');
    if (mode === 'read' && !st?.isFile()) throw new Error(`Not a file in the demo folder: ${rel}`);
    return p;
  };
  const done: string[] = [];
  for (const op of operations) {
    if (op.op === 'copy') {
      const from = await abs(op.from, 'read');
      const to = await abs(op.to, 'write');
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      done.push(`Copied ${op.from} → ${op.to}`);
    } else if (op.op === 'rewrite-reference') {
      const file = await abs(op.file, 'read');
      const text = await fs.readFile(file, 'utf8');
      const variants = [`"${op.from}"`, `'${op.from}'`];
      let next = text;
      let hit = false;
      for (const v of variants) {
        if (next.includes(v)) {
          next = next.split(v).join(v[0] + op.to + v[0]);
          hit = true;
        }
      }
      if (!hit) throw new Error(`Reference “${op.from}” not found in ${op.file}; nothing was changed.`);
      await fs.writeFile(file, next);
      done.push(`In ${op.file}: “${op.from}” → “${op.to}”`);
    }
  }
  return done;
}
