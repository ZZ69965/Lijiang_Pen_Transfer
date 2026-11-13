import { chromium } from 'playwright-core';
/**
 * Same-condition before/after comparison (headless Chromium 1280×720, local
 * vite preview, SwiftShader). Measured with a raw CDP session:
 *   readyMs         click → loading veil gone (painting is interactive)
 *   gatingMB        art bytes RECEIVED before that moment
 *   gatingFiles     which art files had to arrive first
 *   totalMB         art bytes after 6 further seconds
 * NOTE: locally the server and browser share one machine, so byte counts are a
 * structural measure of "what must arrive first", not a network-speed claim.
 */
const targets = [
  { label: 'before (7afa5a8)', url: 'http://127.0.0.1:4174/Lijiang_Pen_Transfer/' },
  { label: 'after (this round)', url: 'http://127.0.0.1:4173/Lijiang_Pen_Transfer/' },
];
const rows = [];
for (let i = 0; i < 5; i += 1) {
  for (const t of targets) {
    const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    // Pixi loads textures inside a worker, so CDP page-level Network misses
    // them; Playwright's context-wide request events see every target.
    const art = [];
    const pending = new Map();
    page.on('request', (req) => {
      const match = req.url().match(/\/art\/([^/]+\.webp)$/);
      if (match) pending.set(req, { name: match[1], start: Date.now() });
    });
    page.on('requestfinished', async (req) => {
      const entry = pending.get(req);
      if (!entry) return;
      pending.delete(req);
      let size = 0;
      try { size = (await req.sizes()).responseBodySize || 0; } catch { /* body gone */ }
      art.push({ ...entry, end: Date.now(), size });
    });
    await page.goto(t.url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /山水漫游/ }).click();
    const t0 = Date.now();
    await page.waitForFunction(() => !document.querySelector('.scene-loading'), null, { timeout: 60000 });
    const ready = Date.now() - t0;
    await page.waitForTimeout(6000);
    const gating = art.filter((a) => a.end && a.end - t0 <= ready + 80);
    const gatingBytes = gating.reduce((sum, a) => sum + (a.size || 0), 0);
    const totalBytes = art.reduce((sum, a) => sum + (a.size || 0), 0);
    rows.push({ target: t.label, run: i + 1, readyMs: ready,
      gatingMB: +(gatingBytes / 1048576).toFixed(2), gatingFiles: gating.map((a) => a.name).sort(),
      totalMB: +(totalBytes / 1048576).toFixed(2) });
    await b.close();
  }
}
const median = (arr) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
for (const t of targets) {
  const list = rows.filter((r) => r.target === t.label);
  console.log(`${t.label}: ready ${median(list.map(r=>r.readyMs))}ms | gating art ${median(list.map(r=>r.gatingMB))}MB | total art ${median(list.map(r=>r.totalMB))}MB`);
  console.log('   gating files (run 1):', list[0].gatingFiles.join(', '));
}
console.log('JSONSTART' + JSON.stringify(rows) + 'JSONEND');
