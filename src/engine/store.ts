// Local run history. Finished runs are written once and never modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Run } from '../domain/model.ts';

export class RunStore {
  constructor(private dir: string) {}

  private file(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid run id.');
    return path.join(this.dir, `${id}.json`);
  }

  async save(run: Run): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const f = this.file(run.id);
    try {
      await fs.access(f);
      throw new Error('Run already stored; historical runs are immutable.');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await fs.writeFile(f, JSON.stringify(run, null, 2), { flag: 'wx' });
  }

  async get(id: string): Promise<Run | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as Run;
    } catch {
      return null;
    }
  }

  async list(): Promise<Pick<Run, 'id' | 'projectName' | 'state' | 'startedAt' | 'finishedAt' | 'rootId' | 'deliveryPath' | 'adapterKind' | 'readiness'>[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out = [];
    for (const n of names.filter((x) => x.endsWith('.json'))) {
      const r = await this.get(n.replace(/\.json$/, ''));
      if (r) out.push({ id: r.id, projectName: r.projectName, state: r.state, startedAt: r.startedAt, finishedAt: r.finishedAt, rootId: r.rootId, deliveryPath: r.deliveryPath, adapterKind: r.adapterKind, readiness: r.readiness });
    }
    return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
