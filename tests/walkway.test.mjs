import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALKWAY, HERO_MIN_X, HERO_MAX_X, HERO_MIN_HEIGHT, HERO_MAX_HEIGHT,
  HERO_REFERENCE_PIXEL_HEIGHT, clampHeroX, isWalkable, walkwayAt,
} from '../src/content/walkway.ts';
import { WORLD_WIDTH, PLACES } from '../src/content/places.ts';

test('the bank-to-bridge path advances continuously in artwork coordinates', () => {
  for (let i = 1; i < WALKWAY.length; i += 1) {
    assert.ok(WALKWAY[i].x > WALKWAY[i - 1].x, `point ${i} must advance along the scroll`);
  }
  assert.equal(WALKWAY[0].x, HERO_MIN_X);
  assert.equal(WALKWAY.at(-1).x, HERO_MAX_X);
});

test('feet remain on the painted path band and the figure fits the local perspective', () => {
  for (let x = 0; x <= WORLD_WIDTH; x += 4) {
    const { y, height } = walkwayAt(x);
    if (isWalkable(x)) {
      assert.ok(y > 400 && y < 495, `x=${x}, y=${y} must stay on a painted bank or deck`);
      assert.ok(height >= HERO_MIN_HEIGHT && height <= HERO_MAX_HEIGHT,
        `x=${x}, height=${height} must stay in the perspective bounds`);
    }
  }
  assert.ok(walkwayAt(620).height > walkwayAt(940).height,
    'foreground riverbank figures should be larger than the distant garden path');
  assert.ok(walkwayAt(1340).height > walkwayAt(1780).height,
    'bridge figures should be larger than visitors farther down the bank');
  assert.ok(walkwayAt(620).height < HERO_MAX_HEIGHT + 1);
  assert.ok(walkwayAt(1780).height > HERO_MIN_HEIGHT - 1);
});

test('position and scale stay continuous through each authored path point', () => {
  for (const point of WALKWAY) {
    for (const coordinate of [point.x - 0.01, point.x + 0.01]) {
      const result = walkwayAt(coordinate);
      assert.ok(Math.abs(result.y - point.y) < 0.1, `y approaches its footline at x=${point.x}`);
      assert.ok(Math.abs(result.height - point.height) < 0.1,
        `perspective scale approaches its anchor at x=${point.x}`);
    }
  }
});

test('scene landmarks map to walkable ground, with the glass bridge across the water', () => {
  for (const place of PLACES) {
    assert.equal(isWalkable(place.standX), true, `${place.id} stand=${place.standX}`);
    const ground = walkwayAt(place.standX);
    assert.ok(ground.y < place.markerY + 90, `${place.id} has a visible land-to-landmark sightline`);
  }
  const glassBridge = PLACES.find((place) => place.id === 'glassbridge');
  assert.ok(glassBridge);
  assert.ok(Math.abs(glassBridge.standX - glassBridge.worldX) > 20,
    'the walker watches the glass bridge from its west bank');
  assert.equal(isWalkable(glassBridge.worldX), false, 'the bridge span is over the river');
  for (const waterX of [0, 172, 300, 490, 1837, 2050, 2172]) {
    assert.equal(isWalkable(waterX), false, `x=${waterX} is outside the connected walkway`);
  }
});

test('movement and old snapshots clamp to the bank-to-bank route', () => {
  assert.equal(clampHeroX(-Infinity), HERO_MIN_X);
  assert.equal(clampHeroX(0), HERO_MIN_X);
  assert.equal(clampHeroX(HERO_MIN_X), HERO_MIN_X);
  assert.equal(clampHeroX(1000), 1000);
  assert.equal(clampHeroX(HERO_MAX_X), HERO_MAX_X);
  assert.equal(clampHeroX(Infinity), HERO_MAX_X);
  assert.equal(clampHeroX(Number.NaN), HERO_MIN_X);
  for (let x = -100; x <= WORLD_WIDTH + 100; x += 3) {
    assert.equal(isWalkable(clampHeroX(x)), true, `clamp(${x}) lands on the path`);
  }
});

test('position-dependent scale is uniform for all native poses at a given location', () => {
  const nearHeight = walkwayAt(620).height;
  const distantHeight = walkwayAt(1780).height;
  const scaleAt = (height) => height / HERO_REFERENCE_PIXEL_HEIGHT;
  assert.equal(scaleAt(nearHeight) * HERO_REFERENCE_PIXEL_HEIGHT, nearHeight);
  assert.equal(scaleAt(distantHeight) * HERO_REFERENCE_PIXEL_HEIGHT, distantHeight);
  assert.ok(scaleAt(nearHeight) > scaleAt(distantHeight), 'perspective scale decreases with depth');
});
