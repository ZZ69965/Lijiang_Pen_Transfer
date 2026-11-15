/** Run against the built Pages subpath, with the preview server already running. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.env.APP_URL || 'http://127.0.0.1:4173/Lijiang_Pen_Transfer/';
const out = process.env.OUT_DIR || 'qa/2026-11-15/drones';
mkdirSync(out, { recursive: true });
const results = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

async function enterNight(page) {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /山水漫游/ }).click();
  await page.locator('.scene-loading').waitFor({ state: 'hidden', timeout: 30000 });
  await page.locator('.scene-header').getByRole('button', { name: '入夜', exact: true }).click();
  await page.locator('.story-entry > button').click();
  await page.getByRole('menuitem').filter({ hasText: '夜游漓江' }).click();
  await page.getByRole('button', { name: '欣赏无人机画稿' }).waitFor();
}

async function openArtwork(page) {
  const button = page.getByRole('button', { name: '欣赏无人机画稿' });
  await page.waitForFunction(() => !document.querySelector('.night-drones-button')?.disabled);
  await button.click();
}

async function ready(page, id) {
  await page.locator(`.drone-viewer[data-artwork="${id}"][data-load-state="ready"]`).waitFor({ timeout: 20000 });
  // A reduced-motion frame must still be rendered by the Pixi ticker.
  await page.waitForTimeout(100);
}

async function controlsFit(page) {
  const box = await page.locator('.drone-viewer').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 &&
    box.y + box.height <= viewport.height + 1, 'artwork controls must be inside the actual viewport');
}

try {
  for (const [device, width, height] of [['desktop', 1280, 720], ['portrait', 390, 844], ['landscape', 844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/night-drones-.*\.webp/.test(request.url())) requests.push(request.url());
    });
    await enterNight(page);
    assert.equal(requests.length, 0, 'night entry must not preload the drone paintings');
    await openArtwork(page);
    await ready(page, 'elephant');
    assert.equal(await page.locator('.encounter-sheet').count(), 0, 'the large story card must close');
    assert.equal(requests.length, 1);
    await controlsFit(page);
    await page.screenshot({ path: `${out}/${device}-elephant.png` });
    await page.getByRole('combobox', { name: '选择无人机画稿' }).selectOption('festival');
    await ready(page, 'festival');
    assert.match(await page.locator('.drone-viewer').innerText(), /原图活动文字与日期/);
    await controlsFit(page);
    await page.screenshot({ path: `${out}/${device}-festival.png` });
    await page.getByRole('combobox', { name: '选择无人机画稿' }).selectOption('elephant');
    await ready(page, 'elephant');
    assert.equal(requests.length, 2, 'switching back reuses the cached artwork');
    await page.keyboard.press('Escape');
    await page.locator('.drone-viewer').waitFor({ state: 'detached' });
    assert.ok(await page.locator('.story-entry > button').evaluate((button) => button === document.activeElement));
    await page.locator('.story-entry > button').click();
    await page.getByRole('menuitem').filter({ hasText: '夜游漓江' }).click();
    await openArtwork(page);
    await ready(page, 'elephant');
    await page.locator('.scene-header').getByRole('button', { name: '夕照', exact: true }).click();
    await page.locator('.drone-viewer').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.scene-error').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ device, passed: true, checks: 'lazy loading, both artworks, cache, viewport, Escape/focus, leaving night' });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/night-drones-elephant.webp', (route) => route.abort());
  await enterNight(page);
  await openArtwork(page);
  await page.locator('.drone-viewer[data-load-state="error"]').waitFor();
  assert.equal(await page.locator('.scene-error').count(), 0, 'an optional image failure cannot fail the panorama');
  await page.unroute('**/night-drones-elephant.webp');
  await page.getByRole('button', { name: '重试载入画稿' }).click();
  await ready(page, 'elephant');
  await page.screenshot({ path: `${out}/retry-recovered.png` });
  results.push({ device: 'desktop', passed: true, checks: 'image failure and retry preserve the painting' });
  await context.close();
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
