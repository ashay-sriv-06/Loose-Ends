// Browser walk-through of the real app: Choose → Check → Show me → Fix → Recheck → Export → Reload.
// Usage: npx tsx scripts/e2e.mts   (server must be running on 127.0.0.1:4177 with the built UI)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';

const BASE = process.env.LOOSE_ENDS_URL ?? 'http://127.0.0.1:4177';
const OUT = path.resolve('docs/screenshots');
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()!;
const executablePath = path.join(cache, shell, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');

const results: { name: string; ok: boolean; note?: string }[] = [];
const step = async (name: string, fn: () => Promise<unknown>) => {
  try {
    const note = await fn();
    results.push({ name, ok: true, note: typeof note === 'string' ? note : undefined });
  } catch (e) {
    results.push({ name, ok: false, note: (e as Error).message.split('\n')[0] });
  }
};
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const browser = await chromium.launch({ executablePath });
await fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

// ---------- desktop ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();

await step('Choose: both questions and the main action are visible', async () => {
  await page.getByRole('heading', { name: 'Can I send this?' }).waitFor();
  await page.getByText('Check your folder against the brief before it reaches your client.').waitFor();
  await page.getByText('What happens when you check').waitFor();
  await page.getByRole('heading', { name: 'Folder to send' }).waitFor();
  await page.getByRole('heading', { name: 'What you promised' }).waitFor();
  await page.getByRole('button', { name: 'Check before sending' }).waitFor();
  await page.screenshot({ path: `${OUT}/01-choose-desktop.png` });
});
await step('Choose: the folder picker browses only allowed folders', async () => {
  await page.getByRole('button', { name: /Delivery.*Change/ }).click();
  await page.getByRole('dialog', { name: 'Folder to send' }).waitFor();
  await page.screenshot({ path: `${OUT}/02-picker-desktop.png` });
  await page.getByRole('button', { name: 'Delivery/' }).click();
  await page.getByRole('button', { name: /Send this folder: Delivery/ }).click();
});
await step('Review: promises read from the brief can be inspected', async () => {
  await page.getByRole('button', { name: /promises found in the brief/ }).click();
  await page.getByText('Dark logo variant as').first().waitFor();
  await page.screenshot({ path: `${OUT}/03-review-promises-desktop.png` });
  await page.getByRole('button', { name: /promises found in the brief/ }).click();
});
await step('Check: a real run produces "Fix before sending" with three blockers', async () => {
  await page.getByRole('button', { name: 'Check before sending' }).click();
  await page.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor();
  const n = await page.locator('.finding.tone-bad').count();
  if (n < 3) throw new Error(`expected at least 3 problem findings, saw ${n}`);
  await page.getByText('This logo uses an image outside the folder you’re sending.').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/04-findings-desktop.png` });
  await page.screenshot({ path: `${OUT}/04-findings-desktop-full.png`, fullPage: true });
});
await step('Show me: evidence drawer shows rule/brief beside the file fact, with technical details behind a disclosure', async () => {
  await page.locator('.finding', { hasText: 'outside the folder' }).getByRole('button', { name: 'Show me' }).click();
  const d = page.getByRole('dialog', { name: 'Evidence for this finding' });
  for (const h of ['The rule', 'The file shows', 'Why this matters', 'What to do next', 'What this check cannot establish']) await d.getByRole('heading', { name: h }).waitFor();
  await d.getByText('../Working/grain.png').first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-show-me-desktop.png` });
  if (await d.getByRole('button', { name: 'Copy path' }).first().isVisible()) throw new Error('technical details should start closed');
  await d.getByText('Technical details').click();
  await d.getByRole('button', { name: 'Copy path' }).first().click();
  await page.keyboard.press('Escape');
  await d.waitFor({ state: 'detached' });
});
await step('Show me: approval mismatch evidence', async () => {
  await page.locator('.finding', { hasText: 'version 7' }).getByRole('button', { name: 'Show me' }).click();
  await page.getByRole('dialog').getByRole('heading', { name: 'The brief says' }).waitFor();
  await page.getByRole('dialog').getByText('Technical details').click();
  await page.getByRole('dialog').getByText('The approved file exists here').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/06-approval-evidence-desktop.png` });
  await page.getByRole('button', { name: 'Close evidence' }).click();
});
await step('What your client gets: graph + table from dependency records', async () => {
  await page.getByRole('tab', { name: 'What your client gets' }).click();
  await page.getByRole('table').getByText('../Working/grain.png').waitFor();
  await page.getByRole('button', { name: /logo\.svg\. Show only its links/ }).click();
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'What your client gets' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 420));
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/07-client-gets-desktop.png` });
  await page.getByRole('tab', { name: /Findings/ }).click();
});
await step('Fix: demo fixes change files and mark results out of date', async () => {
  await page.locator('.finding', { hasText: 'logo-dark.svg' }).getByRole('button', { name: 'Apply demo fix' }).click();
  await page.getByText('Files changed since this check.').waitFor();
  await page.locator('.finding', { hasText: 'outside the folder' }).getByRole('button', { name: 'Apply demo fix' }).click();
  await page.getByText('In Delivery/logo.svg').waitFor();
  await page.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor(); // approval blocker untouched, banner is not green
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/08-stale-after-fix-desktop.png` });
});
await step('Recheck: real diff "2 issues resolved"', async () => {
  await page.getByRole('button', { name: 'Check again' }).first().click();
  await page.getByText(/^2 issues resolved\./).waitFor();
  const blockers = await page.locator('.finding.tone-bad').count();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/09-recheck-diff-desktop.png` });
  return `${await page.locator('.diff b').first().innerText()} · ${blockers} problem card(s) remain`;
});
let runId = '';
await step('Export: receipt opens and downloads', async () => {
  const [popup] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('link', { name: 'Open receipt' }).click()]);
  await popup.waitForLoadState();
  await popup.getByText('This receipt describes the files Loose Ends inspected').waitFor();
  runId = (await popup.locator('code').first().innerText()).trim();
  await popup.setViewportSize({ width: 900, height: 1100 });
  await popup.screenshot({ path: `${OUT}/10-receipt.png` });
  await popup.close();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Save data (JSON)' }).click()]);
  const j = JSON.parse(fs.readFileSync((await dl.path())!, 'utf8'));
  if (j.kind !== 'loose-ends-receipt' || j.runId !== runId) throw new Error('downloaded JSON does not match the run');
  return dl.suggestedFilename();
});
await step('Reload: the run reopens as an earlier check, not as fresh', async () => {
  await page.reload();
  await page.getByText('This is a saved result, not a fresh look at your files.').waitFor();
  await page.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor();
  await page.screenshot({ path: `${OUT}/11-reload-history-desktop.png` });
});
await step('Keyboard: focus ring is visible and tabs respond to arrow keys', async () => {
  await page.getByRole('tab', { name: /Findings/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('table').waitFor();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  await page.screenshot({ path: `${OUT}/12-keyboard-focus-desktop.png` });
  await page.keyboard.press('ArrowLeft');
  if (outline === 'none') throw new Error('no focus outline on the active tab');
});
await step('Edge case: conflicting amendment asks a question and stays unresolved until answered', async () => {
  await page.getByLabel('Load a demo project').selectOption('conflicting-amendment');
  await page.getByText('Two documents disagree about the same deliverable.').waitFor();
  await page.getByRole('button', { name: 'Check before sending' }).click();
  await page.getByRole('heading', { name: 'Needs your review', exact: true }).first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/13-conflict-desktop.png` });
  await page.getByRole('radio').nth(1).check();
  await page.getByText('Your choices changed.').waitFor();
  await page.locator('.go-row .btn.primary').click();
  await page.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor();
});
await step('Edge case: unsupported format is never green', async () => {
  await page.getByLabel('Load a demo project').selectOption('unsupported-format');
  await page.getByRole('button', { name: 'Check before sending' }).click();
  await page.getByText('Loose Ends cannot look inside poster.psd.').waitFor();
  await page.getByRole('heading', { name: 'Needs your review', exact: true }).first().waitFor();
  await page.screenshot({ path: `${OUT}/14-unsupported-desktop.png` });
});
await step('Long paths do not cause horizontal overflow (desktop)', async () => {
  const o = await overflow(page);
  if (o > 1) throw new Error(`page overflows horizontally by ${o}px`);
});
await step('No browser console errors (desktop)', async () => {
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
});
await ctx.close();

// ---------- mobile ----------
await fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const mp = await m.newPage();
const merrors: string[] = [];
mp.on('pageerror', (e) => merrors.push(e.message));
await mp.goto(BASE);
await mp.evaluate(() => localStorage.clear());
await mp.reload();
await step('Mobile: choose → check works at 390px with no horizontal overflow', async () => {
  await mp.getByRole('button', { name: 'Check before sending' }).scrollIntoViewIfNeeded();
  await mp.screenshot({ path: `${OUT}/20-choose-mobile.png` });
  await mp.getByRole('button', { name: 'Check before sending' }).click();
  await mp.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor();
  await mp.getByRole('heading', { name: 'Fix before sending', exact: true }).scrollIntoViewIfNeeded();
  await mp.screenshot({ path: `${OUT}/21-findings-mobile.png` });
  await mp.screenshot({ path: `${OUT}/21-findings-mobile-full.png`, fullPage: true });
  const o = await overflow(mp);
  if (o > 1) throw new Error(`page overflows horizontally by ${o}px`);
});
await step('Mobile: the inspector is a full-width sheet', async () => {
  await mp.locator('.finding', { hasText: 'outside the folder' }).getByRole('button', { name: 'Show me' }).click();
  const box = await mp.getByRole('dialog', { name: 'Evidence for this finding' }).boundingBox();
  await mp.screenshot({ path: `${OUT}/22-show-me-mobile.png` });
  if (!box || Math.round(box.width) !== 390) throw new Error(`sheet width is ${box?.width}`);
  await mp.getByRole('button', { name: 'Close evidence' }).click();
});
await step('Mobile: "What your client gets" scrolls inside its own container', async () => {
  await mp.getByRole('tab', { name: 'What your client gets' }).click();
  await mp.getByRole('table').waitFor();
  await mp.getByRole('tab', { name: 'What your client gets' }).scrollIntoViewIfNeeded();
  await mp.screenshot({ path: `${OUT}/23-client-gets-mobile.png` });
  const o = await overflow(mp);
  if (o > 1) throw new Error(`page overflows horizontally by ${o}px`);
});
await step('Reduced motion: animations are disabled', async () => {
  const d = await mp.evaluate(() => getComputedStyle(document.querySelector('.segmented-thumb')!).transitionDuration);
  if (parseFloat(d) > 0.01) throw new Error(`transition still ${d}`);
});
await step('No page errors (mobile)', async () => {
  if (merrors.length) throw new Error(merrors.join(' | '));
});
await m.close();
await browser.close();
await fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

const pass = results.filter((r) => r.ok).length;
const report = [`# Browser walk-through`, ``, `${pass} of ${results.length} steps passed.`, ``, ...results.map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.note ? ` (${r.note})` : ''}`), ''].join('\n');
fs.writeFileSync('docs/e2e-report.md', report);
console.log(report);
process.exit(pass === results.length ? 0 : 1);
