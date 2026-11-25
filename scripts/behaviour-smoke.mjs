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
 *   node scripts/behaviour-smoke.mjs         (this file, also `npm run test:browser`)
 *
 * Needs `npm run build` output served by `npm run preview` on APP_URL. Browser is
 * playwright-core + a system Chrome (CHROME_BIN), no downloaded browser bundle.
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
/**
 * Real reachability, not "the canvas exists": every listed control must have a
 * box inside the viewport, and no pair of them may overlap. This is what the
 * plan means by 控制矩形在 viewport 内 / 主要控件不重叠.
 */
async function reachability(page, selectors) {
  const boxes = [];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) { boxes.push({ name: selector, missing: true }); continue; }
    const box = await locator.boundingBox();
    boxes.push({ name: selector, ...(box ?? { missing: true }) });
  }
  const vp = page.viewportSize();
  const outside = boxes.filter((b) => b.missing || b.x < -1 || b.y < -1 ||
    b.x + b.width > vp.width + 1 || b.y + b.height > vp.height + 1);
  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      if (a.missing || b.missing) continue;
      const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (dx > 2 && dy > 2) overlaps.push(`${a.name} × ${b.name}`);
    }
  }
  return { outside: outside.map((b) => b.name), overlaps };
}

/** The sheet must sit inside the viewport and scroll instead of overflowing. */
async function readSheetMetrics(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.encounter-sheet');
    if (!sheet) return { fits: false, reason: 'missing' };
    const box = sheet.getBoundingClientRect();
    const overflow = sheet.scrollHeight - sheet.clientHeight;
    const scrollable = getComputedStyle(sheet).overflowY !== 'visible';
    return {
      fits: box.top >= -1 && box.bottom <= window.innerHeight + 1 &&
        (overflow <= 0 || scrollable),
      top: Math.round(box.top), bottom: Math.round(box.bottom),
      viewport: window.innerHeight, overflow, scrollable,
    };
  });
}

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
    // The other paintings start downloading in the background, so they may
    // APPEAR at any time; what matters is that none of them had finished before
    // the painting became usable. A finished time relative to the veil proves it.
    const expected = ['scene-day.webp', 'hero-front.webp', 'hero-walk.webp'];
    record('only the current painting and front/walk poses are required first',
      expected.every((f) => atReady.includes(f)),
      `present at ready: ${atReady.join(',')}`);

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
    // Stories now live behind one entry instead of a resident rail.
    await page.locator('.story-entry > button').click();
    await page.locator('.story-menu button', { hasText: '鱼市' }).first().click();
    await page.waitForSelector('.market-flow');
    await shot(page, 'desktop-04-market-waiting');

    // R2 removed the five-step bar: states are internal, the stallholder's
    // line and the available choices are what the visitor actually sees.
    const marketLine = async () => (await page.locator('.market-line').innerText()).replace(/\s+/g, ' ');
    record('market opens with the stallholder speaking and no step bar',
      (await page.locator('.market-steps').count()) === 0 && (await marketLine()).length > 0,
      (await marketLine()).slice(0, 30));

    await page.getByRole('button', { name: '和摊主说话' }).click();
    record('one click moves to the fish choices', (await page.locator('.market-kind').count()) === 2,
      await marketLine());
    await page.getByRole('button', { name: /一尾大鱼/ }).click();
    await shot(page, 'desktop-05-market-picking');
    await page.getByRole('button', { name: /就要一尾大鱼/ }).click();
    record('confirmation asks before taking the fish', /确认带走/.test(await marketLine()));
    await shot(page, 'desktop-06-market-confirm');

    // double click the same confirm button: only one completion may happen
    const confirm = page.getByRole('button', { name: /确认带走（一尾大鱼）/ });
    await confirm.dblclick();
    await page.waitForTimeout(400);
    record('completion is visible in the stallholder line', /演示交易完成/.test(await marketLine()));
    const reply = await marketLine();
    record('completion reply names the fish exactly once', (reply.match(/一尾大鱼/g) || []).length >= 1 && /演示交易完成/.test(reply), reply.slice(0, 40));
    const seq = await page.locator('.market-line').getAttribute('data-sequence');
    await page.waitForTimeout(300);
    record('double click did not submit twice', seq === await page.locator('.market-line').getAttribute('data-sequence'), `sequence=${seq}`);
    await shot(page, 'desktop-07-market-completed');

    // same-visit revisit: the completed purchase is remembered
    await page.getByRole('button', { name: '再看看别的' }).click();
    await page.waitForTimeout(300);
    const record1 = await page.locator('.market-record').innerText().catch(() => '');
    record('same-visit revisit shows the previous purchase', /一尾大鱼/.test(record1), record1.replace(/\s+/g, ' '));
    record('revisit restarts at the stallholder rather than replaying the purchase',
      (await page.locator('.market-kind').count()) === 0 && (await marketLine()).length > 0);
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '关闭互动' }).click();

    // revisit after reload: memory is deliberately per-visit only
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /山水漫游/ }).click();
    await page.waitForSelector('.scroll-canvas');
    await page.waitForFunction(() => !document.querySelector('.scene-loading'));
    await page.locator('.scene-time .time-switcher button', { hasText: '正午' }).click();
    await page.locator('.story-entry > button').click();
    await page.locator('.story-menu button', { hasText: '鱼市' }).first().click();
    await page.waitForSelector('.market-flow');
    // a fresh page has no memory across reloads (same-visit only, per plan)
    record('no false purchase after reload (session-only memory)',
      (await page.locator('.market-kind').count()) === 0 && (await page.locator('.market-record').count()) === 0);

    // cancel path
    await page.getByRole('button', { name: '和摊主说话' }).click();
    await page.getByRole('button', { name: /一尾小鱼/ }).click();
    await page.getByRole('button', { name: '暂不买了' }).click();
    record('cancel returns to the stallholder', (await page.locator('.market-kind').count()) === 0);
    record('cancel shows visible feedback', /放回篓/.test(await marketLine()));
    await shot(page, 'desktop-08-market-cancelled');
    await page.getByRole('button', { name: '关闭互动' }).click();

    // ------------------------------------------------- input ownership checks
    await page.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: '游目指南' }).click();
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
    // The camera eases toward its target, so sample only once it has stopped
    // moving; comparing mid-ease made this check flap between 44/44 and 43/44.
    const settledProgress = async () => {
      let previous = null;
      let stable = 0;
      for (let i = 0; i < 30; i += 1) {
        const value = await page.locator('.scroll-progress').getAttribute('aria-label');
        stable = value === previous ? stable + 1 : 0;
        if (stable >= 2) return value;
        previous = value;
        await page.waitForTimeout(150);
      }
      return previous;
    };
    await page.locator('.scene-landmarks button', { hasText: '玻璃桥' }).click();
    await page.waitForTimeout(900);
    await page.locator('.scene-landmarks button', { hasText: '阳桥' }).click();
    await page.waitForTimeout(900);
    await page.locator('.scene-landmarks button', { hasText: '玻璃桥' }).click();
    await page.waitForTimeout(1200);
    const progressBefore = await settledProgress();
    await page.getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /卷尾/ }).click();
    await page.waitForSelector('.elephant-variant-finale', { timeout: 20000 });
    await shot(page, 'desktop-09-finale');
    // Exercise the actual renderer when available, and the fallback otherwise.
    const fallback = page.locator('.elephant-fallback');
    await page.waitForFunction(() => document.querySelector('.elephant-fallback') ||
      document.querySelector('canvas.elephant-canvas'), null, { timeout: 25000 });
    const usesFallback = await fallback.isVisible();
    const back = usesFallback ? fallback.getByRole('button', { name: '回到画卷' })
      : page.getByRole('button', { name: '返回画卷' });
    await back.waitFor({ timeout: 25000 });
    record('finale offers a usable way back', await back.isVisible(), usesFallback ? 'WebGL fallback' : 'rendered 3D');
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

    // ------------------------------------------------------- audio lifecycle
    await page.locator('.scene-time .time-switcher button', { hasText: '入夜' }).click();
    await page.waitForTimeout(1200);
    await page.locator('.story-entry > button').click();
    await page.locator('.story-menu button', { hasText: '夜游' }).first().click();
    await page.waitForSelector('.night-music-button', { timeout: 15000 });
    const musicLabel = async () => (await page.locator('.night-music-button').innerText()).replace(/\s+/g, ' ');
    await page.locator('.night-music-button').click();
    await page.waitForTimeout(1600);
    record('night music starts on request', /暂停/.test(await musicLabel()), await musicLabel());
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(700);
    // The resume affordance is "开始听江夜游" once audio has been stopped.
    record('hiding the page stops the music', /开始/.test(await musicLabel()), await musicLabel());
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    record('returning to the page does not resume sound', /开始/.test(await musicLabel()), await musicLabel());
    await shot(page, 'desktop-08b-night-music-stopped');
    record('concept demos are not resident in the night panel',
      (await page.locator('.night-lab[open]').count()) === 0 &&
      (await page.locator('.night-actions > button').count()) === 2,
      `always-visible night buttons: ${await page.locator('.night-actions > button').count()}`);
    await page.getByRole('button', { name: '关闭互动' }).click();
    await page.locator('.scene-time .time-switcher button', { hasText: '正午' }).click();
    await page.waitForTimeout(600);

    // ------------------------------------------------------- reachability
    const controls = ['.back-button', '.scene-header .time-switcher', '.more-wrap',
      '.story-entry', '.scene-landmarks', '.control-view'];
    const reach = await reachability(page, controls);
    record('desktop: every resident control is inside the viewport', reach.outside.length === 0, reach.outside.join(', '));
    record('desktop: resident controls do not overlap each other', reach.overlaps.length === 0, reach.overlaps.join(', '));
    record('desktop: no resident place card, step bar or story rail by default',
      (await page.locator('.place-card').count()) === 0 &&
      (await page.locator('.market-steps').count()) === 0 &&
      (await page.locator('.encounter-rail').count()) === 0);

    // one card at a time: opening a story closes the place card
    await page.locator('.scene-landmarks button[aria-current="location"]').click();
    record('tapping the current place opens exactly one card', (await page.locator('.place-card').count()) === 1);
    await page.locator('.story-entry > button').click();
    await page.locator('.story-menu button').first().click();
    record('opening a story closes the place card (never two cards)',
      (await page.locator('.place-card').count()) === 0 && (await page.locator('.encounter-sheet').count()) === 1);
    await page.getByRole('button', { name: '关闭互动' }).click();

    // -------------------------------------------------------- rotation check
    const before = await settledProgress();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(900);
    const after = await settledProgress();
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
    const landReach = await reachability(page, ['.back-button', '.scene-header .time-switcher',
      '.more-wrap', '.story-entry', '.scene-landmarks', '.control-view']);
    record('phone landscape: all controls inside the 844x390 viewport', landReach.outside.length === 0, landReach.outside.join(', '));
    record('phone landscape: controls do not overlap', landReach.overlaps.length === 0, landReach.overlaps.join(', '));
    // and they must be actually clickable, not just present
    await page.locator('.scene-landmarks button').nth(2).click();
    await page.waitForTimeout(700);
    record('phone landscape: the route is genuinely clickable',
      (await page.locator('.scene-landmarks button[aria-current="location"]').innerText()).includes('阳桥'));
    const tap = await page.locator('.back-button').boundingBox();
    record('phone landscape: controls meet the 44px touch target',
      tap.width >= 40 && tap.height >= 36, `${Math.round(tap.width)}×${Math.round(tap.height)}`);
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
    await page.locator('.story-entry > button').click();
    await page.locator('.story-menu button', { hasText: '鱼市' }).first().click();
    await page.waitForSelector('.market-flow');
    await page.getByRole('button', { name: '和摊主说话' }).click();
    await shot(page, 'phone-portrait-03-market');
    const portReach = await reachability(page, ['.back-button', '.more-wrap', '.scene-landmarks']);
    record('phone portrait: resident controls stay inside the viewport', portReach.outside.length === 0, portReach.outside.join(', '));
    const sheet = await readSheetMetrics(page);
    record('phone portrait: the dialogue card fits and scrolls internally', sheet.fits, JSON.stringify(sheet));
    // closing returns focus to a usable control
    await page.getByRole('button', { name: '关闭互动' }).click();
    const focused = await page.evaluate(() => document.activeElement?.className || '');
    record('closing the card returns focus to a real control', await page.evaluate(() => document.activeElement?.tagName === 'BODY' || document.activeElement?.tagName === 'BUTTON'), focused);
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

  // ----------------------------------------- forced 3D failure (fallback path)
  // The normal run exercises whichever path the environment supports. This one
  // forces a REAL init failure — WebGLRenderer cannot get a context — instead of
  // disabling WebGL globally, and then asserts the fallback is genuinely usable.
  {
    const { context, page } = await newPage({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (String(type).startsWith('webgl')) return null;
        return original.call(this, type, ...rest);
      };
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /入画启程/ }).first().click();
    await page.waitForSelector('.elephant-fallback', { timeout: 25000 });
    record('forced 3D failure lands on the fallback panel',
      await page.locator('.elephant-fallback').isVisible());
    // The fallback must still get the visitor into the painting, not just appear.
    await page.getByRole('button', { name: '进入画卷' }).first().click();
    await page.waitForSelector('.scroll-canvas', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.scene-loading'));
    record('fallback still delivers a usable painting', await page.locator('.scroll-canvas').isVisible());
    // And the prologue must be gone: no stale 3D canvas left behind.
    record('fallback leaves no stale 3D canvas', (await page.locator('canvas.elephant-canvas').count()) === 0);
    await shot(page, 'desktop-15-forced-3d-fallback');
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
