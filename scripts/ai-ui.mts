// Browser check of the model-related screens. Needs two servers:
//   4177 without a model (setup screen), 4178 with LOOSE_ENDS_MODEL and a "Northwind" root (live AI reading).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()!;
const browser = await chromium.launch({ executablePath: path.join(cache, shell, 'chrome-headless-shell-mac-arm64/chrome-headless-shell') });
const out = 'docs/screenshots';
const results: [string, boolean, string][] = [];
const step = async (name: string, fn: () => Promise<string | void>) => {
  try {
    results.push([name, true, (await fn()) ?? '']);
  } catch (e) {
    results.push([name, false, String((e as Error).message).split('\n')[0]]);
  }
};
// --- no model configured ---
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:4177');
await step('no model: default mode is Fixed rules, labelled', async () => {
  await page.getByRole('button', { name: /Acme Brand Launch/ }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Change', exact: true }).click({ timeout: 1500 }).catch(() => {});
  await page.locator('.read-mode').waitFor();
  const t = await page.locator('.read-mode').innerText();
  if (!/No AI\. Fixed patterns/.test(t)) throw new Error(t);
});
await step('no model: choosing AI-assisted shows setup steps and blocks the check', async () => {
  await page.locator('.read-mode').getByText('AI-assisted', { exact: true }).click();
  await page.locator('.model-problem').waitFor();
  const t = await page.locator('.model-problem').innerText();
  if (!/ollama pull/.test(t) || !/LOOSE_ENDS_MODEL=/.test(t) || !/No promises were taken/.test(t)) throw new Error(t);
  if (!(await page.locator('.go-row .btn.primary').isDisabled())) throw new Error('check button still enabled');
  await page.screenshot({ path: `${out}/22-ai-setup-screen.png` });
});
await step('no model: By hand still works', async () => {
  await page.locator('.model-problem').getByText('Enter promises by hand').click();
  await page.locator('.model-problem').waitFor({ state: 'detached' });
  if (await page.locator('.go-row .btn.primary').isDisabled()) throw new Error('check button disabled in manual mode');
  const t = await page.locator('.read-mode').innerText();
  if (!/Nothing is read from the brief/.test(t)) throw new Error(t);
});
await page.close();
// --- live model ---
page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto('http://127.0.0.1:4178');
await page.evaluate(async () => {
  localStorage.setItem('loose-ends:read-mode', 'ai');
});
await step('live model: AI-assisted reading shows labelled promises', async () => {
  // choose root + paths through the same state the picker sets, by replaying a stored run of this root
  const runs = await (await fetch('http://127.0.0.1:4178/api/runs')).json();
  // The run store is shared by every local instance, so pick a run whose brief really exists under this instance's root.
  let r: { id: string } | undefined;
  // Real folders get an id derived from their path, so ask the service which one it has.
  const cfgRoots = (await (await fetch('http://127.0.0.1:4178/api/config')).json()).roots as { id: string; kind: string }[];
  const realId = cfgRoots.find((x) => x.kind === 'local-actual')?.id ?? '';
  for (const x of runs.runs.filter((y: { rootId: string }) => y.rootId === realId)) {
    const full = (await (await fetch(`http://127.0.0.1:4178/api/runs/${x.id}`)).json()).run;
    const dir = full.briefPaths[0]?.split('/').slice(0, -1).join('/') ?? '';
    const tree = await (await fetch(`http://127.0.0.1:4178/api/tree?rootId=${realId}&path=${encodeURIComponent(dir)}`)).json();
    if (tree.entries?.some((e: { path: string }) => e.path === full.briefPaths[0])) {
      r = x;
      break;
    }
  }
  if (!r) throw new Error('no stored run for the Northwind folder');
  await page.evaluate((id) => localStorage.setItem('loose-ends:last-run', id), r.id);
  await page.reload();
  await page.getByRole('button', { name: 'Change', exact: true }).click({ timeout: 1500 }).catch(() => {});
  await page.locator('.promises .disclosure').waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes('Reading the brief with the model'), null, { timeout: 120000 });
  await page.locator('.promises .disclosure').click();
  await page.locator('.promise-panel').waitFor();
  const t = await page.locator('.promise-panel').innerText();
  if (!/AI-assisted \(ollama:/.test(t) || !/AI-suggested · quoted from brief/.test(t) || !/Fixed rules/.test(t)) throw new Error(t.slice(0, 300));
  await page.screenshot({ path: `${out}/23-ai-assisted-promises.png` });
  return t.split('\n')[0];
});
await step('live model: model conflict suggestion is shown as a suggestion', async () => {
  const t = await page.locator('.promise-panel').innerText();
  if (!/The model thinks these may disagree/.test(t)) throw new Error('no conflict suggestion in this reading');
});
await step('live model: plain-language help appears in the evidence panel without changing the result', async () => {
  const before = await page.locator('.status-line, .verdict, h1').first().innerText().catch(() => '');
  await page.getByRole('button', { name: /Explain in plain language \(AI\)/ }).click();
  await page.getByText(/explanation\(s\) added/).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: 'Show me' }).first().click();
  await page.locator('.ai-note').waitFor({ timeout: 10000 });
  const t = await page.locator('.ai-note').innerText();
  if (!/Written by a model/.test(t)) throw new Error(t);
  const after = await page.locator('.status-line, .verdict, h1').first().innerText().catch(() => '');
  if (before !== after) throw new Error('status text changed');
  await page.screenshot({ path: `${out}/24-ai-plain-language.png` });
  return t.replace(/\n/g, ' ').slice(0, 220);
});
await browser.close();
const lines = results.map(([n, ok, d]) => `| ${ok ? 'pass' : '**FAIL**'} | ${n} | ${d.replace(/\|/g, '/')} |`);
fs.writeFileSync('docs/ai-ui-report.md', `# Browser check of model-related screens\n\nRun ${new Date().toISOString()}.\n\n| Result | Step | Detail |\n|---|---|---|\n${lines.join('\n')}\n`);
console.log(lines.join('\n'));
console.log(`${results.filter((r) => r[1]).length} of ${results.length} steps passed.`);
