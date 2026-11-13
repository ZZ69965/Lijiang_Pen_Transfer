import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALKWAY, WALKABLE_SPANS, footlineReviewAt, walkwayY, clampHeroX, isWalkable,
  HERO_HEIGHT, HERO_SCALE, HERO_REFERENCE_PIXEL_HEIGHT, HERO_MIN_X, HERO_MAX_X,
} from '../src/content/walkway.ts';
import { WORLD_WIDTH, WORLD_HEIGHT, PLACES } from '../src/content/places.ts';

test('footline is monotonic in X so the walker never walks backwards into the painting', () => {
  for (let i = 1; i < WALKWAY.length; i += 1) {
    assert.ok(WALKWAY[i].x > WALKWAY[i - 1].x, `segment ${i} must advance in X`);
  }
  // Ground starts on the left bank and ends on the right-bank platform; the
  // open water left of the bank is not walkable.
  assert.equal(WALKWAY[0].x, HERO_MIN_X);
  assert.equal(WALKWAY[WALKWAY.length - 1].x, HERO_MAX_X);
});

test('footline stays on the painted lower band and inside the scroll', () => {
  for (let x = 0; x <= WORLD_WIDTH; x += 10) {
    const y = walkwayY(x);
    assert.ok(Number.isFinite(y), `finite at ${x}`);
    assert.ok(y > 380 && y < 540, `x=${x} y=${y} must stay in the bank/bridge band`);
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
  const bridge = footlineReviewAt(1340);
  assert.equal(bridge.review, 'pending', 'bridge deck is not yet verified against the artwork');
  assert.equal(bridge.foreground, true, 'bridge parapet must occlude the walker once layered');

  // Measured bank and platform segments are checked and carry no parapet.
  for (const x of [600, 900, 1800, 2000]) {
    const zone = footlineReviewAt(x);
    assert.equal(zone.review, 'checked', `x=${x} reviewed`);
    assert.equal(zone.foreground, false, `x=${x} no rail`);
  }
});

test('象鼻山 is an island: the walker never stands in front of it', () => {
  // The painted hill sits at x≈172 entirely surrounded by water. Ground used to
  // run through it, which is exactly what made the figure float.
  const elephant = PLACES.find((place) => place.id === 'elephant');
  assert.ok(elephant);
  assert.equal(isWalkable(elephant.worldX), false, 'the framing point is water');
  assert.equal(isWalkable(elephant.standX), true, 'but the standing point is bank');
  assert.ok(elephant.standX - elephant.worldX > 200, 'the walker watches across the water');
  for (const x of [0, 172, 300, 490]) {
    assert.equal(isWalkable(x), false, `x=${x} is river or island rock`);
  }
});

test('every place has a standing point on painted ground', () => {
  for (const place of PLACES) {
    assert.equal(isWalkable(place.standX), true, `${place.id} standX=${place.standX}`);
    assert.equal(clampHeroX(place.standX), place.standX, `${place.id} standX is already valid`);
    const zone = footlineReviewAt(place.standX);
    assert.ok(['checked', 'pending'].includes(zone.review));
    assert.ok(walkwayY(place.standX) < place.markerY + 90, `${place.id} marker sits above the ground`);
  }
});

test('clamping snaps onto the nearest painted land, never onto water', () => {
  assert.equal(clampHeroX(-500), HERO_MIN_X);
  assert.equal(clampHeroX(0), HERO_MIN_X);
  assert.equal(clampHeroX(1000), 1000);
  assert.equal(clampHeroX(HERO_MAX_X + 999), HERO_MAX_X);
  for (let x = -200; x <= 2400; x += 7) {
    const snapped = clampHeroX(x);
    assert.equal(isWalkable(snapped), true, `input ${x} → ${snapped}`);
  }
});

test('walkable spans are ordered, non-overlapping and inside the world', () => {
  for (let i = 1; i < WALKABLE_SPANS.length; i += 1) {
    assert.ok(WALKABLE_SPANS[i].from >= WALKABLE_SPANS[i - 1].to, 'spans advance and do not overlap');
  }
  for (const span of WALKABLE_SPANS) {
    assert.ok(span.from < span.to);
    assert.ok(span.from >= 0 && span.to <= WORLD_WIDTH);
  }
});

test('hero height is calibrated to the painted architecture, not chosen freely', () => {
  // Reduced from 116 to 96 in R2: the painted revetment parapet is ~34 world
  // pixels (hip height), so a standing figure belongs near 2.8x that.
  assert.equal(HERO_HEIGHT, 96);
  assert.ok(HERO_SCALE > 0 && HERO_SCALE < 0.2, 'source art is downscaled only to world scale');
  assert.equal(HERO_SCALE, HERO_HEIGHT / HERO_REFERENCE_PIXEL_HEIGHT);
});

test('each landmark carries a framed zoom and a waterline for local motion', () => {
  for (const place of PLACES) {
    // Framing zoom stays near the fit scale: tighter frames the subject, and the
    // engine floors it at "painting fills the viewport" so no cream margins show.
    assert.ok(place.zoom >= 0.9 && place.zoom <= 1.3, `${place.id} zoom=${place.zoom}`);
    // Ambient shimmer must sit on water that is at or below the standing ground,
    // never up in the mountains.
    const ground = walkwayY(place.standX);
    assert.ok(place.waterY >= ground, `${place.id} water ${place.waterY} is below ground ${ground}`);
    assert.ok(place.waterY <= WORLD_HEIGHT - 20, `${place.id} waterline stays above the scroll edge`);
  }
});
