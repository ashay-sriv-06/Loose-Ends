// Runtime boundary: the only place that touches the filesystem for scanning.
// Every path coming from outside is relative to an authorized root and is
// validated here. Symlinks are never followed. Nothing is fetched remotely.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AdapterKind, Artifact, ArtifactKind, CoverageGap } from '../domain/model.ts';

export const LIMITS = {
  maxFiles: 5000,
  maxDepth: 12,
  maxTextBytes: 2_000_000,
  maxHashBytes: 256_000_000,
};

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

export interface AuthorizedRoot {
  id: string;
  label: string;
  kind: AdapterKind;
  absPath: string; // real path
}

/** Normalizes a browser-supplied relative path. Rejects absolute paths, traversal and NULs. */
export function normalizeRel(rel: string): string {
  if (typeof rel !== 'string') throw new ScopeError('Path must be a string.');
  if (rel.includes('\0')) throw new ScopeError('Path contains an invalid character.');
  const unified = rel.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:\//.test(unified)) throw new ScopeError('Absolute paths are not accepted.');
  const norm = path.posix.normalize(unified);
  if (norm === '.' || norm === './') return '';
  if (norm === '..' || norm.startsWith('../')) throw new ScopeError('Path leaves the authorized folder.');
  return norm.replace(/\/$/, '');
}

export function isInside(parent: string, child: string): boolean {
  if (parent === '') return true;
  return child === parent || child.startsWith(parent + '/');
}

export interface FileAdapter {
  readonly kind: AdapterKind;
  readonly root: AuthorizedRoot;
  /** `known`: artifacts from an earlier inventory. A file with the same size and modified time reuses its fingerprint instead of being read again. Used only for "has anything changed?" polling, never for a check. */
  inventory(deliveryPath: string, signal?: AbortSignal, onProgress?: (done: number) => void, known?: Map<string, Artifact>): Promise<InventoryResult>;
  readBytes(rel: string, max?: number): Promise<Buffer>;
  readText(rel: string): Promise<string>;
  stat(rel: string): Promise<{ size: number; mtimeMs: number } | null>;
  exists(rel: string): Promise<boolean>;
}

export interface InventoryResult {
  artifacts: Artifact[];
  gaps: CoverageGap[];
  complete: boolean;
  cancelled: boolean;
}

export class LocalFsAdapter implements FileAdapter {
  readonly kind: AdapterKind;
  constructor(readonly root: AuthorizedRoot) {
    this.kind = root.kind;
  }

  /** Resolves a relative path and proves the real location is still inside the root. */
  async resolve(rel: string): Promise<string> {
    const norm = normalizeRel(rel);
    const abs = path.join(this.root.absPath, norm);
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      throw new ScopeError(`Not found in the authorized folder: ${norm || '.'}`);
    }
    if (real !== this.root.absPath && !real.startsWith(this.root.absPath + path.sep))
      throw new ScopeError('Path resolves outside the authorized folder.');
    return real;
  }

  async stat(rel: string) {
    try {
      const abs = await this.resolve(rel);
      const s = await fs.stat(abs);
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      return null;
    }
  }

  async exists(rel: string) {
    return (await this.stat(rel)) !== null;
  }

  async readBytes(rel: string, max = LIMITS.maxTextBytes): Promise<Buffer> {
    const abs = await this.resolve(rel);
    const fh = await fs.open(abs, 'r');
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, max);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      return buf;
    } finally {
      await fh.close();
    }
  }

  async readText(rel: string): Promise<string> {
    return (await this.readBytes(rel)).toString('utf8');
  }

  async listDir(rel: string): Promise<{ name: string; path: string; type: 'dir' | 'file'; size?: number }[]> {
    const abs = await this.resolve(rel);
    const norm = normalizeRel(rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const out: { name: string; path: string; type: 'dir' | 'file'; size?: number }[] = [];
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const p = norm ? `${norm}/${e.name}` : e.name;
      if (e.isDirectory()) out.push({ name: e.name, path: p, type: 'dir' });
      else if (e.isFile()) out.push({ name: e.name, path: p, type: 'file', size: (await fs.stat(path.join(abs, e.name))).size });
      if (out.length >= 500) break;
    }
    return out;
  }

  async inventory(deliveryPath: string, signal?: AbortSignal, onProgress?: (done: number) => void, known?: Map<string, Artifact>): Promise<InventoryResult> {
    const delivery = normalizeRel(deliveryPath);
    await this.resolve(delivery);
    const artifacts: Artifact[] = [];
    const gaps: CoverageGap[] = [];
    let complete = true;
    let cancelled = false;

    const walk = async (rel: string, depth: number): Promise<void> => {
      if (signal?.aborted) {
        cancelled = true;
        return;
      }
      if (depth > LIMITS.maxDepth) {
        complete = false;
        gaps.push({ kind: 'limit-reached', path: rel, reason: `Folders deeper than ${LIMITS.maxDepth} levels were not scanned.` });
        return;
      }
      const abs = path.join(this.root.absPath, rel);
      let entries;
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch (e) {
        complete = false;
        gaps.push({ kind: 'unreadable', path: rel, reason: 'This folder could not be read.' });
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (signal?.aborted) {
          cancelled = true;
          return;
        }
        if (e.name === '.DS_Store' || e.name === '.git' || e.name === 'node_modules') continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) {
          gaps.push({ kind: 'symlink-not-followed', path: childRel, reason: 'Shortcut (symlink) was not followed, so its target was not checked.' });
          if (isInside(delivery, childRel)) complete = false;
          continue;
        }
        if (e.isDirectory()) {
          await walk(childRel, depth + 1);
          continue;
        }
        if (!e.isFile()) continue;
        if (artifacts.length >= LIMITS.maxFiles) {
          if (complete) gaps.push({ kind: 'limit-reached', reason: `More than ${LIMITS.maxFiles} files; the rest were not scanned.` });
          complete = false;
          return;
        }
        artifacts.push(await this.describe(childRel, delivery, gaps, known?.get(childRel)));
        onProgress?.(artifacts.length);
      }
    };
    await walk('', 0);
    if (cancelled) complete = false;
    return { artifacts, gaps, complete, cancelled };
  }

  private async describe(rel: string, delivery: string, gaps: CoverageGap[], known?: Artifact): Promise<Artifact> {
    const abs = path.join(this.root.absPath, rel);
    const name = path.posix.basename(rel);
    const extension = path.posix.extname(name).toLowerCase().replace('.', '');
    const inDelivery = isInside(delivery, rel);
    try {
      const s = await fs.stat(abs);
      if (known && known.readable && known.size === s.size && known.mtimeMs === s.mtimeMs) return { ...known, inDelivery };
      let sha256: string | null = null;
      let head = Buffer.alloc(0);
      if (s.size <= LIMITS.maxHashBytes) {
        sha256 = await hashFile(abs);
        const fh = await fs.open(abs, 'r');
        try {
          head = Buffer.alloc(Math.min(s.size, 512));
          await fh.read(head, 0, head.length, 0);
        } finally {
          await fh.close();
        }
      }
      return {
        path: rel,
        name,
        size: s.size,
        mtimeMs: s.mtimeMs,
        sha256,
        identityStrength: sha256 ? 'content-hash' : 'size-and-mtime',
        kind: sniffKind(head, extension),
        extension,
        inDelivery,
        readable: true,
        note: sha256 ? undefined : 'Too large to fingerprint; changes are detected by size and modified time only.',
      };
    } catch {
      gaps.push({ kind: 'unreadable', path: rel, reason: 'This file could not be read.' });
      return { path: rel, name, size: 0, mtimeMs: 0, sha256: null, identityStrength: 'size-and-mtime', kind: 'unknown', extension, inDelivery, readable: false, note: 'Unreadable' };
    }
  }
}

/** How many files have been fingerprinted by reading their full contents (diagnostic). */
export const hashStats = { files: 0 };

export function hashFile(abs: string): Promise<string> {
  hashStats.files++;
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(abs)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** File kind from content. The extension is used only for text formats that have no signature. */
export function sniffKind(head: Buffer, extension: string): ArtifactKind {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const text = head.toString('utf8');
  const looksText = !head.includes(0);
  if (looksText && /<svg[\s>]/i.test(text)) return 'svg';
  if (looksText && extension === 'svg' && /^\s*(<\?xml|<!--|<!DOCTYPE)/i.test(text)) return 'svg';
  if (looksText && (extension === 'md' || extension === 'markdown')) return 'markdown';
  if (looksText && (extension === 'txt' || extension === 'csv' || extension === 'json')) return 'text';
  return 'unknown';
}
