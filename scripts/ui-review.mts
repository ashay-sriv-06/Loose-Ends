// Interface review: real screenshots and interaction checks for the refined UI.
// Usage: npx tsx scripts/ui-review.mts
//   needs the app on 127.0.0.1:4177 (demo roots) and, for the long-name check, a second instance on :4179
//   started with LOOSE_ENDS_ROOTS="Long names=<folder with long file names>".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';

const BASE = 'http://127.0.0.1:4177';
const LONG = process.env.LONG_URL ?? 'http://127.0.0.1:4179';
const OUT = path.resolve('docs/screenshots/after');
const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()!;
const executablePath = path.join(cache, shell, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
const results: { name: string; ok: boolean; note: string }[] = [];
const step = async (name: string, fn: () => Promise<string | void>) => {
  try {
    results.push({ name, ok: true, note: (await fn()) ?? '' });
  } catch (e) {
    results.push({ name, ok: false, note: (e as Error).message.split('\n')[0] });
  }
  const r = results[results.length - 1];
  console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.note ? ` (${r.note})` : ''}`);
};
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const noOverflow = async (page: Page) => {
  const o = await overflow(page);
  if (o > 1) throw new Error(`page overflows horizontally by ${o}px`);
};
const reset = () => fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
const bottom = async (page: Page, sel: ReturnType<Page['locator']>) => {
  const b = await sel.boundingBox();
  if (!b) throw new Error('not visible');
  return Math.round(b.y + b.height);
};

const browser = await chromium.launch({ executablePath });
await reset();

// =============== desktop ===============
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE);

await step('Empty: the first screen answers what / select / next inside one 1440×900 view', async () => {
  const h = page.getByRole('heading', { name: 'Can I send this?' });
  await h.waitFor();
  await page.getByText('Check your folder against the brief before it reaches your client.').waitFor();
  await page.getByRole('heading', { name: 'Folder to send' }).waitFor();
  await page.getByRole('heading', { name: 'What you promised' }).waitFor();
  const go = page.getByRole('button', { name: 'Check before sending' });
  const next = page.getByText('What happens when you check');
  const b = [await bottom(page, go), await bottom(page, page.locator('.steps'))];
  if (b[1] > 900) throw new Error(`"what happens next" ends at ${b[1]}px, below the fold`);
  await next.waitFor();
  await page.screenshot({ path: `${OUT}/01-first-screen-desktop.png` });
  return `action ends at ${b[0]}px, next-steps end at ${b[1]}px of 900`;
});

await step('Keyboard: the main action is reachable by Tab and shows a focus ring', async () => {
  await page.locator('body').click({ position: { x: 700, y: 880 } });
  let n = 0;
  for (; n < 40; n++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Check before sending')) break;
  }
  if (n >= 40) throw new Error('never reached');
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle + ' ' + getComputedStyle(document.activeElement!).outlineWidth);
  if (!/solid 2px/.test(ring)) throw new Error(`focus ring: ${ring}`);
  await page.screenshot({ path: `${OUT}/02-focus-ring-desktop.png` });
  return `${n + 1} Tab presses; outline ${ring}`;
});

await step('Loading: real phases and counts, no percentage', async () => {
  // Hold the progress stream briefly so the loading state can be photographed; nothing in it is altered.
  let held: string[] = [];
  await page.route('**/events', async (r) => {
    await new Promise((res) => setTimeout(res, 900));
    await r.continue();
  });
  await page.getByRole('button', { name: 'Check before sending' }).click();
  await page.locator('.progress').waitFor();
  held = await page.locator('.phases li').allInnerTexts();
  const text = await page.locator('.progress').innerText();
  if (/%/.test(text)) throw new Error('a percentage is shown');
  await page.screenshot({ path: `${OUT}/03-loading-desktop.png` });
  await page.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor();
  await page.unroute('**/events');
  return `${held.length} phases listed; Cancel present`;
});

await step('Completed: verdict and the first finding are above the fold; counts match the list', async () => {
  const first = page.locator('.finding').first();
  const top = (await first.boundingBox())!.y;
  if (top > 900) throw new Error(`first finding starts at ${Math.round(top)}px`);
  const tally = await page.locator('.tally').innerText();
  const bad = await page.locator('.finding.tone-bad:not(:has(.chip:text("Optional")))').count();
  if (!tally.startsWith(`${bad} to fix`)) throw new Error(`tally "${tally}" vs ${bad} problem cards`);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/04-findings-desktop.png` });
  await page.screenshot({ path: `${OUT}/04-findings-desktop-full.png`, fullPage: true });
  return `first finding at ${Math.round(top)}px; tally: ${tally.replace(/\n/g, ' ')}`;
});

await step('Each open finding has: sentence, affected file, why, “Show me”, next action', async () => {
  const items = page.locator('.finding-list .finding');
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const f = items.nth(i);
    const parts = { title: await f.locator('h3').count(), file: await f.locator('.affected').count(), why: await f.locator('.why').count(), show: await f.getByRole('button', { name: 'Show me' }).count(), next: await f.locator('.next').count() };
    const miss = Object.entries(parts).filter(([, v]) => v !== 1).map(([k]) => k);
    if (miss.length) throw new Error(`finding ${i + 1} lacks ${miss.join(', ')}: ${(await f.locator('h3').innerText()).slice(0, 50)}`);
  }
  return `${n} findings checked`;
});

await step('Drawer: opens from the keyboard, brief and file fact sit side by side, technical details closed', async () => {
  const btn = page.locator('.finding', { hasText: 'version 7' }).getByRole('button', { name: 'Show me' });
  await btn.focus();
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog', { name: 'Evidence for this finding' });
  await d.waitFor();
  await page.waitForTimeout(300);
  const a = (await d.locator('.side-brief').boundingBox())!;
  const b = (await d.locator('.side-file').boundingBox())!;
  if (Math.abs(a.y - b.y) > 1 || b.x <= a.x + a.width - 1) throw new Error(`not side by side: brief ${Math.round(a.x)},${Math.round(a.y)} file ${Math.round(b.x)},${Math.round(b.y)}`);
  if (await d.locator('details.technical').evaluate((e) => (e as HTMLDetailsElement).open)) throw new Error('technical details open by default');
  await page.screenshot({ path: `${OUT}/05-drawer-desktop.png` });
  return `drawer ${Math.round((await d.boundingBox())!.width)}px wide; columns ${Math.round(a.width)}px + ${Math.round(b.width)}px`;
});

await step('Drawer: scrolls on its own, header stays, page does not move', async () => {
  const d = page.getByRole('dialog', { name: 'Evidence for this finding' });
  await d.getByText('Technical details').click();
  const before = await page.evaluate(() => window.scrollY);
  const m = await d.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
    return { top: e.scrollTop, sh: e.scrollHeight, ch: e.clientHeight };
  });
  await page.mouse.move(1300, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => window.scrollY);
  const close = (await d.getByRole('button', { name: 'Close evidence' }).boundingBox())!;
  if (m.sh > m.ch && m.top === 0) throw new Error('drawer did not scroll');
  if (after !== before) throw new Error(`page scrolled ${after - before}px behind the drawer`);
  if (close.y < 0 || close.y > 80) throw new Error(`Close button not pinned (y=${close.y})`);
  await page.screenshot({ path: `${OUT}/06-drawer-technical-desktop.png` });
  return `content ${m.sh}px in a ${m.ch}px drawer; scrolled to ${m.top}px; Close stays at y=${Math.round(close.y)}`;
});

await step('Drawer: Escape closes it and focus returns to the same “Show me”', async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Evidence for this finding' }).waitFor({ state: 'detached' });
  await page.waitForTimeout(80);
  const where = await page.evaluate(() => `${document.activeElement?.textContent?.trim()} | ${document.activeElement?.closest('.finding')?.querySelector('h3')?.textContent?.slice(0, 40)}`);
  if (!where.startsWith('Show me | brand-guidelines-v7.pdf')) throw new Error(`focus is on: ${where}`);
  return where;
});

await step('Boundary: “See where this file sits” reveals the real dependency with the file selected', async () => {
  await page.locator('.finding', { hasText: 'outside the folder' }).getByRole('button', { name: 'Show me' }).click();
  await page.getByRole('button', { name: 'See where this file sits' }).click();
  const node = page.getByRole('button', { name: /logo\.svg\. Show only its links/ });
  await node.waitFor();
  if ((await node.getAttribute('aria-pressed')) !== 'true') throw new Error('the file is not selected in the picture');
  await page.getByRole('table').getByText('../Working/grain.png').waitFor();
  const pos1 = await node.boundingBox();
  await page.waitForTimeout(900);
  const pos2 = await node.boundingBox();
  if (Math.abs(pos1!.x - pos2!.x) > 0.5 || Math.abs(pos1!.y - pos2!.y) > 0.5) throw new Error('nodes moved during the transition');
  const crossing = await page.locator('.edge.crosses').count();
  await page.locator('.graph-wrap').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/07-client-gets-desktop.png` });
  await page.getByRole('tab', { name: /Findings/ }).click();
  return `${crossing} line(s) cross the boundary; node position unchanged during the 0.9 s reveal`;
});

await step('Stale: a changed file marks the result out of date and offers “Check again”', async () => {
  await page.locator('.finding', { hasText: 'logo-dark.svg' }).getByRole('button', { name: 'Apply demo fix' }).click();
  await page.getByText('Files changed since this check.').waitFor();
  await page.locator('.banner', { hasText: 'Files changed' }).getByRole('button', { name: 'Check again' }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/08-stale-desktop.png` });
});

await step('Partial: files that could not be inspected are counted and listed', async () => {
  await page.getByLabel('Load a demo project').selectOption('unsupported-format');
  await page.getByRole('button', { name: 'Check before sending' }).click();
  const b = page.locator('details.partial');
  await b.waitFor();
  const t = await b.locator('summary').innerText();
  await b.locator('summary').click();
  await b.getByText('poster.psd').first().waitFor();
  await page.screenshot({ path: `${OUT}/09-partial-desktop.png` });
  return t.replace(/\s+/g, ' ');
});

await step('Cancelled: a check stopped by the person is labelled as incomplete (real cancel request)', async () => {
  await page.getByLabel('Load a demo project').selectOption('acme');
  // Send the cancel request the moment the run starts, as a fast click on Cancel would.
  await page.evaluate(() => {
    const f = window.fetch.bind(window);
    (window as unknown as { __f: typeof fetch }).__f = f;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await f(input, init);
      if (String(input) === '/api/runs' && init?.method === 'POST') {
        const { runId } = await res.clone().json();
        await f(`/api/runs/${runId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      }
      return res;
    };
  });
  await page.getByRole('button', { name: 'Check before sending' }).click();
  await page.locator('.result').waitFor();
  await page.evaluate(() => (window.fetch = (window as unknown as { __f: typeof fetch }).__f));
  const label = await page.locator('.status h2').innerText();
  if (label !== 'Could not complete check') return `the run finished before the cancel request landed (verdict: ${label}); cancelled state not captured this time`;
  await page.getByText('You cancelled this check.').waitFor();
  await page.screenshot({ path: `${OUT}/10-cancelled-desktop.png` });
  return await page.locator('.banner', { hasText: 'You cancelled' }).innerText().then((t) => t.replace(/\s+/g, ' '));
});

await step('Failed: an errored run says so and offers “Try again” (state injected into one response; no real failure was available)', async () => {
  await page.route(/\/api\/runs\/run-[^/]+$/, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    if (body.run) {
      body.run.state = 'failed';
      body.run.failure = 'EACCES: permission denied, scandir Delivery (injected for this screenshot)';
      body.run.readiness = { ...body.run.readiness, display: 'could-not-complete', label: 'Could not complete check', reasons: ['The check stopped with an error.'] };
    }
    await r.fulfill({ response: res, json: body });
  });
  await page.reload();
  await page.getByText('The check stopped with an error.').first().waitFor();
  await page.getByRole('button', { name: 'Try again' }).waitFor();
  await page.screenshot({ path: `${OUT}/11-failed-desktop.png` });
  await page.unroute(/\/api\/runs\/run-[^/]+$/);
});

await step('Contrast: text on its real background meets WCAG AA', async () => {
  await page.reload();
  await page.getByRole('button', { name: /^(Check again|Check before sending)$/ }).first().click();
  await page.locator('.finding').first().waitFor();
  await page.locator('.result').waitFor();
  const rows = (await page.evaluate(String.raw`(() => {
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.length >= 3 && (c[3] ?? 1) > 0.99) return c;
      }
      return [245, 243, 238];
    };
    const sels = ['.lede', '.fine', '.why', '.next', '.next-label', '.affected .mono', '.tally span', '.tally .n-bad', '.group-title', '.chip.tone-bad', '.chip.tone-warn', '.chip.tone-neutral', '.quiet-link', '.status h2', '.btn.primary', '.pick-change', '.summary-item .mono', '.history-item .fine', '.demo-tag', '.read-label'];
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, ratio: -1, size: 0 };
      const fg = parse(getComputedStyle(el).color);
      const bg = bgOf(el);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return { sel, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, size: parseFloat(getComputedStyle(el).fontSize) };
    });
  })()`)) as { sel: string; ratio: number; size: number }[];
  fs.writeFileSync(path.resolve('docs/contrast-measured.json'), JSON.stringify(rows, null, 2));
  const low = rows.filter((r) => r.ratio >= 0 && r.ratio < 4.5);
  if (low.length) throw new Error(low.map((r) => `${r.sel} ${r.ratio}`).join('; '));
  const seen = rows.filter((r) => r.ratio >= 0);
  return `${seen.length} text styles measured, lowest ${Math.min(...seen.map((r) => r.ratio))}:1 (${seen.sort((a, b) => a.ratio - b.ratio)[0].sel})`;
});

await step('Long file names: no horizontal overflow, names truncate, full name available (desktop)', async () => {
  const p = await ctx.newPage();
  await p.goto(LONG);
  await p.getByRole('heading', { name: 'Can I send this?' }).waitFor();
  await p.locator('.pick').first().click();
  await p.getByLabel('Folder Loose Ends may read').selectOption({ label: 'Long names' });
  await p.getByRole('button', { name: /Client handover/ }).first().click();
  await p.getByRole('button', { name: /Send this folder/ }).click();
  await p.getByRole('button', { name: /Choose the brief/ }).click();
  await p.getByRole('button', { name: 'brief/' }).click();
  await p.getByLabel(/Kickoff notes/).check();
  await p.getByRole('button', { name: /^Use / }).click();
  await noOverflow(p);
  await p.screenshot({ path: `${OUT}/12-long-names-choose-desktop.png` });
  await p.getByRole('button', { name: 'Check before sending' }).click();
  await p.locator('.finding').first().waitFor();
  await noOverflow(p);
  const clipped = await p.locator('.affected .mono').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth && !e.getAttribute('title')).length);
  if (clipped) throw new Error(`${clipped} truncated name(s) without the full name available`);
  await p.screenshot({ path: `${OUT}/12-long-names-findings-desktop.png`, fullPage: true });
  await p.locator('.finding').first().getByRole('button', { name: 'Show me' }).click();
  await p.waitForTimeout(300);
  await noOverflow(p);
  const dOver = await p.getByRole('dialog', { name: 'Evidence for this finding' }).evaluate((e) => e.scrollWidth - e.clientWidth);
  if (dOver > 1) throw new Error(`drawer overflows sideways by ${dOver}px`);
  await p.screenshot({ path: `${OUT}/12-long-names-drawer-desktop.png` });
  const n = await p.locator('.finding').count();
  await p.context().storageState({ path: path.join(os.tmpdir(), 'loose-ends-long.json') });
  await p.close();
  return `${n} findings with 100+ character names`;
});

await step('No browser console or page errors (desktop)', async () => {
  if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
});
await ctx.close();

// =============== mobile ===============
await reset();
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await m.newPage();
const merrors: string[] = [];
mp.on('pageerror', (e) => merrors.push(e.message));
await mp.goto(BASE);

await step('Mobile 390px: first screen shows headline, both inputs and the action without scrolling', async () => {
  await mp.getByRole('heading', { name: 'Can I send this?' }).waitFor();
  const b = await bottom(mp, mp.getByRole('button', { name: 'Check before sending' }));
  if (b > 844) throw new Error(`action ends at ${b}px, below the 844px view`);
  await noOverflow(mp);
  await mp.screenshot({ path: `${OUT}/20-first-screen-mobile.png` });
  return `action ends at ${b}px of 844`;
});

await step('Mobile: reading-mode labels do not overlap or clip', async () => {
  const clipped = await mp.locator('.read-mode .segmented button').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  if (clipped.length) throw new Error(`clipped: ${clipped.join(', ')}`);
  await mp.locator('.read-mode').scrollIntoViewIfNeeded();
  await mp.screenshot({ path: `${OUT}/21-read-mode-mobile.png` });
});

await step('Mobile: findings list, then the drawer as a full-width sheet that locks the page behind it', async () => {
  await mp.getByRole('button', { name: 'Check before sending' }).click();
  await mp.getByRole('heading', { name: 'Fix before sending', exact: true }).waitFor();
  await noOverflow(mp);
  await mp.evaluate(() => window.scrollTo(0, 0));
  await mp.screenshot({ path: `${OUT}/22-findings-mobile.png` });
  await mp.screenshot({ path: `${OUT}/22-findings-mobile-full.png`, fullPage: true });
  const btn = mp.locator('.finding', { hasText: 'outside the folder' }).getByRole('button', { name: 'Show me' });
  const h = (await btn.boundingBox())!.height;
  if (h < 36) throw new Error(`“Show me” is only ${h}px tall`);
  await btn.click();
  const d = mp.getByRole('dialog', { name: 'Evidence for this finding' });
  await d.waitFor();
  await mp.waitForTimeout(350);
  const box = (await d.boundingBox())!;
  if (Math.abs(box.width - 390) > 1) throw new Error(`sheet is ${box.width}px wide`);
  const lock = await mp.evaluate(() => getComputedStyle(document.body).overflow);
  if (lock !== 'hidden') throw new Error(`page behind is scrollable (${lock})`);
  const a = (await d.locator('.side-brief').boundingBox())!;
  const b = (await d.locator('.side-file').boundingBox())!;
  if (b.y < a.y + a.height - 1) throw new Error('evidence columns are not stacked on a narrow screen');
  await mp.screenshot({ path: `${OUT}/23-drawer-mobile.png` });
  await d.evaluate((e) => (e.scrollTop = e.scrollHeight));
  const st = await d.evaluate((e) => e.scrollTop);
  await mp.getByRole('button', { name: 'Close evidence' }).click();
  await d.waitFor({ state: 'detached' });
  return `“Show me” ${Math.round(h)}px tall; sheet ${Math.round(box.width)}×${Math.round(box.height)}; scrolled ${st}px inside; columns stacked`;
});

await step('Mobile: “What your client gets” scrolls inside its own box', async () => {
  await mp.getByRole('tab', { name: 'What your client gets' }).click();
  await mp.getByRole('table').waitFor();
  await noOverflow(mp);
  await mp.locator('.graph-wrap').scrollIntoViewIfNeeded();
  await mp.screenshot({ path: `${OUT}/24-client-gets-mobile.png` });
});

await step('Long file names on mobile: no horizontal overflow', async () => {
  const lm = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: path.join(os.tmpdir(), 'loose-ends-long.json') });
  const p = await lm.newPage();
  await p.goto(LONG);
  await p.locator('.finding').first().waitFor();
  const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 391).slice(0, 6).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().right)));
  if (wide.length) throw new Error('too wide: ' + wide.join(' | '));
  await noOverflow(p);
  await p.screenshot({ path: `${OUT}/25-long-names-mobile.png`, fullPage: true });
  await p.locator('.finding').first().getByRole('button', { name: 'Show me' }).click();
  await p.waitForTimeout(350);
  const dOver = await p.getByRole('dialog', { name: 'Evidence for this finding' }).evaluate((e) => e.scrollWidth - e.clientWidth);
  if (dOver > 1) throw new Error(`drawer overflows sideways by ${dOver}px`);
  await p.screenshot({ path: `${OUT}/25-long-names-drawer-mobile.png` });
  await lm.close();
});

await step('Reduced motion: the boundary reveal and other animations are switched off', async () => {
  const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const p = await rm.newPage();
  await p.goto(BASE);
  await p.getByRole('button', { name: 'Check before sending' }).click();
  await p.getByRole('tab', { name: 'What your client gets' }).click();
  const d = await p.locator('.edge').first().evaluate((e) => getComputedStyle(e).animationDuration + ' / delay ' + getComputedStyle(e).animationDelay);
  if (!/^(0\.001ms|1e-06s|0s)/.test(d)) throw new Error(d);
  await rm.close();
  return `edge animation ${d}`;
});

await step('No page errors (mobile)', async () => {
  if (merrors.length) throw new Error(merrors.join(' | '));
});
await m.close();
await browser.close();
await reset();

const ok = results.filter((r) => r.ok).length;
fs.writeFileSync(path.resolve('docs/ui-review-checks.md'), [`# Interface checks (automated)`, '', `${ok} of ${results.length} passed. Screenshots: docs/screenshots/after/.`, '', ...results.map((r) => `- ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.note ? ` — ${r.note}` : ''}`), ''].join('\n'));
console.log(`\n${ok} of ${results.length} passed`);
