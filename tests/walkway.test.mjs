import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALKWAY, footlineReviewAt, walkwayY, clampHeroX, HERO_HEIGHT, HERO_SCALE,
  HERO_REFERENCE_PIXEL_HEIGHT,
} from '../src/content/walkway.ts';
import { WORLD_WIDTH, PLACES } from '../src/content/places.ts';

test('footline is monotonic in X so the walker never walks backwards into the painting', () => {
  for (let i = 1; i < WALKWAY.length; i += 1) {
    assert.ok(WALKWAY[i].x > WALKWAY[i - 1].x, `segment ${i} must advance in X`);
  }
  assert.equal(WALKWAY[0].x, 70);
  assert.equal(WALKWAY[WALKWAY.length - 1].x, 2104);
});

test('footline stays on the painted lower band and inside the scroll', () => {
  for (let x = 0; x <= WORLD_WIDTH; x += 10) {
    const y = walkwayY(x);
    assert.ok(Number.isFinite(y), `finite at ${x}`);
    assert.ok(y > 300 && y < 520, `x=${x} y=${y} must stay in the bank/bridge band`);
  }
});

test('interpolation is continuous at the segment joints', () => {
  for (const point of WALKWAY) {
    const before = walkwayY(point.x - 0.01);
    const after = walkwayY(point.x + 0.01);
    assert.ok(Math.abs(before - point.y) < 0.5, `approaches ${point.y} from the left`);
    assert.ok(Math.abs(after - point.y) < 0.5, `leaves ${point.y} to the right`);
  }
});

test('阳桥 span is explicitly marked pending and needs a foreground layer', () => {
  const bridge = footlineReviewAt(1326);
  assert.equal(bridge.review, 'pending', 'bridge deck is not yet verified against the artwork');
  assert.equal(bridge.foreground, true, 'bridge rail must occlude the walker once layered');

  // The flat bank far from the bridge is checked and has no foreground rail.
  for (const x of [300, 800, 1800, 2000]) {
    const zone = footlineReviewAt(x);
    assert.equal(zone.review, 'checked', `x=${x} reviewed`);
    assert.equal(zone.foreground, false, `x=${x} no rail`);
  }
});

test('every landmark X resolves to a defined review state', () => {
  for (const place of PLACES) {
    const zone = footlineReviewAt(place.worldX);
    assert.ok(['checked', 'pending'].includes(zone.review));
    assert.ok(walkwayY(place.worldX) < place.markerY + 60, `${place.id} marker sits above the footline`);
  }
});

test('hero stays inside the painted bank and keeps native pixel height', () => {
  assert.equal(clampHeroX(-500), 55);
  assert.equal(clampHeroX(99999), 2104);
  assert.equal(clampHeroX(1000), 1000);
  // Heights remain near-native: art is never re-scaled into a blurry sprite.
  assert.ok(HERO_HEIGHT >= 100 && HERO_HEIGHT <= 130);
  assert.ok(HERO_SCALE > 0 && HERO_SCALE < 0.2, 'source art is downscaled only to world scale');
  assert.equal(HERO_SCALE, HERO_HEIGHT / HERO_REFERENCE_PIXEL_HEIGHT);
});
