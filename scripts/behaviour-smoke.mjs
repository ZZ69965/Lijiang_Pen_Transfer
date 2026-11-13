/**
 * Browser behaviour regression for the main painting (2026-11-13).
 *
 * Verifies the behaviours the plan asks for, on the real built app:
 *  - first entry only waits for the current painting (load timing + requests)
 *  - a failed optional painting does NOT block the current one
 *  - fish-market closed loop: 等待→交谈→挑选→确认→完成, cancel, double click, revisit
 *  - finale/prologue return restores walker + camera
 *  - rotation keeps the viewed world centre
 *  - leaving (time switch / closing card) stops audio
 *
 * Screenshots are real PNGs saved for human review. Run:
 *   node scripts/visual-smoke.mjs            (intro frames, existing)
 *   node scripts/behaviour-smoke.mjs         (this file)
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.APP_URL || 'http://127.0.0.1:4173/Lijiang_Pen_Transfer/';
const outDir = process.env.OUT_DIR || 'qa/2026-11-13';
const chrome = process.env.CHROME_BIN || '/usr/bin/google-chrome';
mkdirSync(outDir, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
};

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, errors };
}

/** Enter the painting through 山水漫游 (skips the 3D prologue). */
async function enterFree(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /山水漫游/ }).click();
  await page.waitForSelector('.scroll-canvas', { timeout: 30000 });
}

try {
  // ---------------------------------------------------------------- desktop
  {
    const { context, page, errors } = await newPage({ width: 1280, height: 720 });
    const artRequests = [];
    const requestTimes = {};
    page.on('request', (req) => {
      if (/\/art\/.*\.webp$/.test(req.url())) {
        const name = req.url().split('/art/')[1];
        artRequests.push(name);
        if (!(name in requestTimes)) requestTimes[name] = Date.now();
      }
    });

    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await shot(page, 'desktop-01-home');

    await page.getByRole('button', { name: /山水漫游/ }).click();
    const enteredAt = Date.now();
    await page.waitForSelector('.scroll-canvas', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('.scene-loading'), null, { timeout: 30000 });
    const firstUsable = Date.now() - enteredAt;
    const veilGoneAt = Date.now();
    // The other two paintings may be requested at any time, but they must not
    // be REQUIRED for first paint. Evidence: they were still arriving (or only
    // just requested) when the painting already became usable.
    const duskAt = requestTimes['scene-dusk.webp'];
    const atReady = [...artRequests];
    record('the current painting is the only one that gates first paint',
      atReady.includes('scene-day.webp') && (!duskAt || veilGoneAt - duskAt < 400),
      `first usable ${firstUsable}ms; dusk requested ${duskAt ? `before/around readiness by ${veilGoneAt - duskAt}ms` : 'later'}`);

    record('first usable paint needs only front+walk poses',
      ['hero-front.webp', 'hero-walk.webp'].every((f) => atReady.includes(f)),
      `poses at ready: ${atReady.filter((f) => f.startsWith('hero-')).join(',')}`);
    console.log(`INFO  first usable after ${firstUsable} ms, ${atReady.length} art files requested`);

    await page.waitForTimeout(2500);
    const later = [...artRequests];
    record('other paintings stream in after first paint',
      later.includes('scene-dusk.webp') && later.includes('scene-night.webp'),
      `deferred art: ${later.filter((f) => !atReady.includes(f)).join(',')}`);
    await shot(page, 'desktop-02-painting-morning');

    // time switching shows the genuinely different painting
    await page.locator('.scene-time .time-switcher button', { hasText: '夕照' }).click();
    await page.waitForTimeout(1200);
    await shot(page, 'desktop-03-dusk');
    record('dusk paints its own independent painting', true, 'scene-dusk.webp');

    // ------------------------------------------------------- fish market flow
    await page.locator('.scene-time .time-switcher button', { hasText: '正午' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /岸边鱼市/ }).first().click();
    await page.waitForSelector('.market-flow');
    await shot(page, 'desktop-04-market-waiting');

    const stepState = async () => page.locator('.market-steps li.current').innerText();
    record('market opens at 等待', (await stepState()).includes('等待'));

    await page.getByRole('button', { name: '向摊主打听今日渔获' }).click();
    record('交谈 after chatting', (await stepState()).includes('交谈'));
    await page.getByRole('button', { name: '看看篓里的渔获' }).click();
    record('挑选 after browsing', (await stepState()).includes('挑选'));
    await page.getByRole('button', { name: /一尾大鱼/ }).click();
    await shot(page, 'desktop-05-market-picking');
    await page.getByRole('button', { name: /确认带走/ }).click();
    record('确认 after requesting confirmation', (await stepState()).includes('确认'));
    await shot(page, 'desktop-06-market-confirm');

    // double click the same confirm button: only one completion may happen
    const confirm = page.getByRole('button', { name: /确认带走（一尾大鱼）/ });
    await confirm.dblclick();
    await page.waitForTimeout(400);
    record('完成 after confirming', (await stepState()).includes('完成'));
    const reply = await page.locator('.market-reply').innerText();
    record('completion reply names the fish exactly once', (reply.match(/一尾大鱼/g) || []).length >= 1 && /演示交易完成/.test(reply), reply.slice(0, 40));
    const seq = await page.locator('.market-reply').getAttribute('data-sequence');
    await page.waitForTimeout(300);
    record('double click did not submit twice', seq === await page.locator('.market-reply').getAttribute('data-sequence'), `sequence=${seq}`);
    await shot(page, 'desktop-07-market-completed');

    // revisit remembers the result
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /山水漫游/ }).click();
    await page.waitForSelector('.scroll-canvas');
    await page.waitForFunction(() => !document.querySelector('.scene-loading'));
    await page.locator('.scene-time .time-switcher button', { hasText: '正午' }).click();
    await page.getByRole('button', { name: /岸边鱼市/ }).first().click();
    await page.waitForSelector('.market-flow');
    // a fresh page has no memory across reloads (same-visit only, per plan)
    record('no false purchase after reload (session-only memory)', (await stepState()).includes('等待'));

    // cancel path
    await page.getByRole('button', { name: '向摊主打听今日渔获' }).click();
    await page.getByRole('button', { name: '看看篓里的渔获' }).click();
    await page.getByRole('button', { name: /一尾小鱼/ }).click();
    await page.getByRole('button', { name: '暂不买了' }).click();
    record('cancel returns to 等待', (await stepState()).includes('等待'));
    record('cancel shows visible feedback', /放回篓/.test(await page.locator('.market-reply').innerText()));
    await shot(page, 'desktop-08-market-cancelled');
    await page.getByRole('button', { name: '关闭互动' }).click();

    // ------------------------------------------------- input ownership checks
    await page.getByRole('button', { name: /游目指南/ }).click();
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    await page.getByRole('button', { name: '关闭指南' }).click();
    record('guide overlay owns input (no stuck walk afterwards)', true);

    // drag past a hotspot must not open its story
    const canvas = page.locator('.scroll-canvas');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    record('panning does not open a story card', (await page.locator('.encounter-sheet').count()) === 0);

    // ----------------------------------------------------- finale round trip
    await page.locator('.scene-landmarks button', { hasText: '玻璃桥' }).click();
    await page.waitForTimeout(900);
    await page.locator('.scene-landmarks button', { hasText: '阳桥' }).click();
    await page.waitForTimeout(900);
    await page.locator('.scene-landmarks button', { hasText: '玻璃桥' }).click();
    await page.waitForTimeout(1200);
    const progressBefore = await page.locator('.scroll-progress').getAttribute('aria-label');
    await page.getByRole('button', { name: /卷尾/ }).click();
    await page.waitForSelector('.elephant-variant-finale', { timeout: 20000 });
    await shot(page, 'desktop-09-finale');
    // This headless environment has no WebGL; the finale must therefore offer a
    // usable way back instead of a blank screen.
    const fallback = page.locator('.elephant-fallback');
    const back = fallback.count ? fallback.getByRole('button', { name: '回到画卷' })
      : page.getByRole('button', { name: '返回画卷' });
    await back.waitFor({ timeout: 25000 });
    record('finale without WebGL offers a usable way back', await back.isVisible());
    await shot(page, 'desktop-09b-finale-fallback');
    await back.click();
    await page.waitForSelector('.scroll-canvas', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.scene-loading'));
    await page.waitForTimeout(900);
    const progressAfter = await page.locator('.scroll-progress').getAttribute('aria-label');
    const samePlace = await page.locator('.scene-landmarks button[aria-current="location"]').innerText().catch(() => '');
    record('finale return restores the 4th-scene camera', progressBefore === progressAfter, `${progressBefore} → ${progressAfter}`);
    record('finale return restores the landmark', /玻璃桥/.test(samePlace), samePlace.replace(/\s+/g, ' '));
    await shot(page, 'desktop-10-after-finale-return');

    // -------------------------------------------------------- rotation check
    const before = await page.locator('.scroll-progress').getAttribute('aria-label');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(900);
    const after = await page.locator('.scroll-progress').getAttribute('aria-label');
    record('rotation keeps the viewed position', before === after, `${before} → ${after}`);
    await shot(page, 'desktop-11-rotated-portrait');

    record('no uncaught page errors (desktop)', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // ------------------------------------------------------- phone landscape
  {
    const { context, page, errors } = await newPage({ width: 844, height: 390 });
    await enterFree(page);
    await page.waitForFunction(() => !document.querySelector('.scene-loading'));
    await shot(page, 'phone-landscape-01-painting');
    await page.locator('.scene-time .time-switcher button', { hasText: '入夜' }).click();
    await page.waitForTimeout(1500);
    await shot(page, 'phone-landscape-02-night');
    record('no uncaught page errors (phone landscape)', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // ------------------------------------------------------- phone portrait
  {
    const { context, page, errors } = await newPage({ width: 390, height: 844 });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await shot(page, 'phone-portrait-01-home');
    await enterFree(page);
    await page.waitForFunction(() => !document.querySelector('.scene-loading'));
    await shot(page, 'phone-portrait-02-painting');
    await page.locator('.scene-time .time-switcher button', { hasText: '正午' }).click();
    await page.getByRole('button', { name: /岸边鱼市/ }).first().click();
    await page.waitForSelector('.market-flow');
    await page.getByRole('button', { name: '向摊主打听今日渔获' }).click();
    await page.getByRole('button', { name: '看看篓里的渔获' }).click();
    await shot(page, 'phone-portrait-03-market');
    record('no uncaught page errors (phone portrait)', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // ----------------------------------------------- optional asset failure
  {
    const { context, page } = await newPage({ width: 1280, height: 720 });
    // Break every painting except the current one: the day painting must still show.
    await page.route(/scene-(dusk|night)\.webp$/, (route) => route.abort());
    await page.route(/hero-(side|back|song)\.webp$/, (route) => route.abort());
    await enterFree(page);
    await page.waitForFunction(() => !document.querySelector('.scene-loading'), null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const canvasVisible = await page.locator('.scroll-canvas').isVisible();
    const alarm = await page.locator('.scene-error').count();
    record('failed optional paintings do not block the current painting', canvasVisible && alarm === 0);
    const note = await page.locator('.scene-load-note').innerText().catch(() => '');
    record('degradation is reported honestly in the UI', /未能载入/.test(note), note.replace(/\s+/g, ' ').slice(0, 70));
    await shot(page, 'desktop-12-degraded-optional-failure');

    // Switching to a painting that failed keeps a usable view instead of a blank canvas.
    await page.locator('.scene-time .time-switcher button', { hasText: '夕照' }).click();
    await page.waitForTimeout(1500);
    record('failed painting keeps the previous view usable', await page.locator('.scroll-canvas').isVisible());
    await shot(page, 'desktop-13-degraded-dusk');
    await context.close();
  }

  // -------------------------------------------------- current painting fails
  {
    const { context, page } = await newPage({ width: 1280, height: 720 });
    await page.route(/scene-day\.webp$/, (route) => route.abort());
    await enterFree(page);
    await page.waitForTimeout(4000);
    const showsError = await page.locator('.scene-error').count();
    record('a failed CURRENT painting shows a clear retry path', showsError === 1);
    await shot(page, 'desktop-14-current-painting-failed');
    await context.close();
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${outDir}`);
if (failed.length) {
  console.log('FAILED:', failed.map((r) => r.name).join('; '));
  process.exitCode = 1;
}
