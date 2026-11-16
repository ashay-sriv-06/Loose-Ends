// Starts the local companion API on loopback.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthorizedRoot } from '../engine/adapter.ts';
import { modelConfigFromEnv } from '../engine/model.ts';
import { FIXTURE_MARKER, buildAcme, buildEdgeCases } from '../fixture/build.ts';
import { createApp } from './app.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '../..');
const fixturesDir = path.join(project, 'fixtures');
const port = Number(process.env.LOOSE_ENDS_PORT ?? 4177);

async function ensure(dir: string, build: (d: string) => Promise<void>) {
  try {
    await fs.access(path.join(dir, FIXTURE_MARKER));
  } catch {
    await build(dir);
  }
}

async function main() {
  const demo = path.join(fixturesDir, 'acme');
  const edge = path.join(fixturesDir, 'edge');
  await ensure(demo, (d) => buildAcme(d));
  await ensure(edge, (d) => buildEdgeCases(d));
  const roots: AuthorizedRoot[] = [
    { id: 'demo', label: 'Demo project (synthetic files)', kind: 'synthetic-fixture', absPath: await fs.realpath(demo) },
    { id: 'edge', label: 'Edge cases (synthetic files)', kind: 'synthetic-fixture', absPath: await fs.realpath(edge) },
  ];
  // Real folders are allowlisted by the person running the app, never chosen by path from the browser:
  //   LOOSE_ENDS_ROOTS="Client work=/Users/me/Projects/client;Archive=/Volumes/nas/archive"
  const extra = (process.env.LOOSE_ENDS_ROOTS ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  for (const item of extra) {
    const eq = item.indexOf('=');
    const label = eq > 0 ? item.slice(0, eq) : path.basename(item);
    const p = eq > 0 ? item.slice(eq + 1) : item;
    try {
      // The id identifies the folder itself, so earlier runs can never attach to a different folder after the list changes.
      const abs = await fs.realpath(p);
      const id = `local-${createHash('sha256').update(abs).digest('hex').slice(0, 10)}`;
      if (!roots.some((r) => r.id === id)) roots.push({ id, label, kind: 'local-actual', absPath: abs });
    } catch {
      console.warn(`Skipping allowlisted folder that does not exist: ${p}`);
    }
  }
  const modelCfg = modelConfigFromEnv(process.env);
  let staticDir: string | undefined = path.join(project, 'dist');
  try {
    await fs.access(path.join(staticDir, 'index.html'));
  } catch {
    staticDir = undefined;
  }
  const { server } = createApp({ dataDir: path.join(project, '.data'), fixturesDir, roots, staticDir, model: modelCfg ? { cfg: modelCfg } : null });
  console.log(modelCfg ? `Local model for reading briefs: ${modelCfg.model} at ${modelCfg.baseUrl}` : 'No model configured (set LOOSE_ENDS_MODEL to an Ollama model name to enable). Briefs are read by fixed rules.');
  server.listen(port, '127.0.0.1', () => {
    console.log(`Loose Ends companion API on http://127.0.0.1:${port} (loopback only)`);
    console.log(`Folders it may read: ${roots.map((r) => `${r.label} [${r.kind}]`).join(', ')}`);
    if (staticDir) console.log(`Open http://127.0.0.1:${port}`);
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
