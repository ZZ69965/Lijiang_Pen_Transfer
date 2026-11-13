import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraAround, centreOf, clampLeft, clampZoom, fitZoom, isDrag, resizeCamera, zoomBounds,
} from '../src/content/viewport.ts';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../src/content/places.ts';

const desktop = { width: 1280, height: 720 };
const portrait = { width: 390, height: 844 };
const landscapePhone = { width: 844, height: 390 };

test('zoom always fits the native height and never distorts aspect', () => {
  for (const view of [desktop, portrait, landscapePhone]) {
    const zoom = fitZoom(view);
    assert.ok(Math.abs(zoom - Math.max(0.42, view.height / WORLD_HEIGHT)) < 1e-9);
    const bounds = zoomBounds(view);
    assert.ok(bounds.minimum < bounds.maximum);
    assert.equal(clampZoom(999, view), bounds.maximum);
    assert.equal(clampZoom(0.0001, view), bounds.minimum);
  }
});

test('camera window is clamped inside the 2172-wide painting', () => {
  const zoom = 1;
  assert.equal(clampLeft(-500, zoom, desktop), 0);
  assert.equal(clampLeft(99999, zoom, desktop), WORLD_WIDTH - desktop.width / zoom);
  // A viewport wider than the painting is centred rather than left-aligned.
  const wide = { width: WORLD_WIDTH + 400, height: 724 };
  assert.equal(clampLeft(1234, 1, wide), (WORLD_WIDTH - wide.width) / 2);
});

test('rotation keeps the viewed world centre (no view jump)', () => {
  // Start on desktop, pull the camera somewhere in the middle of the scroll.
  const start = cameraAround(1326, 1, desktop);
  assert.ok(Math.abs(centreOf(start, desktop) - 1326) < 1e-6);

  // Rotate the phone: the world centre must survive the re-fit.
  const rotated = resizeCamera(cameraAround(1326, fitZoom(portrait), portrait), portrait, landscapePhone);
  const centre = centreOf(rotated, landscapePhone);
  assert.ok(Math.abs(centre - 1326) < 1e-6, `centre drifted to ${centre}`);
  
  // Portrait round-trip also keeps the centre.
  const back = resizeCamera(rotated, landscapePhone, portrait);
  assert.ok(Math.abs(centreOf(back, portrait) - 1326) < 0.001);
});

test('rotation re-fits default zoom but preserves a user-chosen zoom', () => {
  const defaultZoom = fitZoom(portrait);
  const def = resizeCamera(cameraAround(900, defaultZoom, portrait), portrait, landscapePhone);
  assert.ok(Math.abs(def.zoom - fitZoom(landscapePhone)) < 1e-9, 'default zoom follows the new viewport');

  const userZoom = clampZoom(fitZoom(portrait) * 1.3, portrait);
  const custom = resizeCamera(cameraAround(900, userZoom, portrait), portrait, landscapePhone);
  assert.ok(Math.abs(custom.zoom - clampZoom(userZoom, landscapePhone)) < 1e-9, 'user zoom preserved');
});

test('resize near the painting edge stays clamped instead of jumping outside', () => {
  const atStart = cameraAround(0, fitZoom(portrait), portrait);
  const rotated = resizeCamera(atStart, portrait, landscapePhone);
  assert.ok(rotated.left >= 0 && rotated.left <= WORLD_WIDTH - landscapePhone.width / rotated.zoom);
});

test('drag threshold separates a tap from a pan', () => {
  assert.equal(isDrag({ x: 100, y: 100 }, { x: 102, y: 101 }), false, 'small movement is a tap');
  assert.equal(isDrag({ x: 100, y: 100 }, { x: 120, y: 100 }), true, '20px is a pan');
  assert.equal(isDrag({ x: 100, y: 100 }, { x: 100, y: 100 }), false);
});

test('default desktop zoom shows a full-height painting without upscaling past bounds', () => {
  const zoom = fitZoom(desktop);
  assert.ok(Math.abs(zoom - 720 / WORLD_HEIGHT) < 1e-9);
  assert.ok(zoom * WORLD_WIDTH > desktop.width, 'a 3:1 painting is wider than 16:9, so it pans');
});
