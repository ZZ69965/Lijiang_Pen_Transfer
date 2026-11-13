import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERO_HEIGHT, HERO_SCALE, HERO_REFERENCE_PIXEL_HEIGHT } from '../src/content/walkway.ts';

/**
 * Checks the ORIGINAL pose files themselves, so a future re-export cannot
 * silently change the figure's size. No image library: the WebP header is read
 * directly (same approach as scripts/verify-assets.mjs).
 */
const files = {
  front: 'public/art/hero-front.webp',
  side: 'public/art/hero-side.webp',
  back: 'public/art/hero-back.webp',
  walk: 'public/art/hero-walk.webp',
  song: 'public/art/hero-song.webp',
};

function webpSize(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  let offset = 12;
  while (offset + 8 < buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    if (type === 'VP8L') {
      const bits = buffer.readUInt32LE(offset + 9);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, lossless: true };
    }
    if (type === 'VP8X') {
      return {
        width: buffer.readUIntLE(offset + 12, 3) + 1,
        height: buffer.readUIntLE(offset + 15, 3) + 1,
        lossless: false,
      };
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error('no WebP image chunk');
}

test('every pose is a lossless WebP at its original resolution', () => {
  for (const [pose, path] of Object.entries(files)) {
    const size = webpSize(readFileSync(path));
    assert.equal(size.lossless, true, `${pose} must stay lossless`);
    assert.ok(size.height > 1200, `${pose} keeps native pixel height (${size.height})`);
  }
});

test('all poses share one scale factor, so the figure never changes size', () => {
  const sizes = Object.fromEntries(
    Object.entries(files).map(([pose, path]) => [pose, webpSize(readFileSync(path))]),
  );
  // The reference is the standing front pose; the factor is derived from it alone.
  assert.equal(sizes.front.height, HERO_REFERENCE_PIXEL_HEIGHT);
  assert.ok(Math.abs(HERO_SCALE - HERO_HEIGHT / sizes.front.height) < 1e-12);

  // Widths are allowed to differ (stride, spread arms) but the PIXEL density of
  // the character must be identical, i.e. no pose may be pre-scaled differently.
  // Verify by world width at the shared factor staying in a plausible band.
  for (const [pose, size] of Object.entries(sizes)) {
    const worldWidth = size.width * HERO_SCALE;
    const worldHeight = size.height * HERO_SCALE;
    // R2 lowered HERO_HEIGHT 116 → 96 to match the painted architecture.
    assert.ok(worldWidth > 18 && worldWidth < 65, `${pose} world width ${worldWidth.toFixed(1)}`);
    assert.ok(worldHeight > 78 && worldHeight < 105, `${pose} world height ${worldHeight.toFixed(1)}`);
  }
  // A stride pose is shorter than standing — the very reason height-alignment
  // used to enlarge it. Guard against reintroducing per-pose height alignment.
  const walkingWorldHeight = sizes.walk.height * HERO_SCALE;
  assert.ok(walkingWorldHeight < HERO_HEIGHT, 'walk bounding box is shorter than standing');
});

test('stored reference documents the measured proportions', () => {
  const front = webpSize(readFileSync(files.front));
  assert.equal(front.width, 523);
  assert.equal(front.height, 1536);
});
