import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERO_REFERENCE_PIXEL_HEIGHT, walkwayAt } from '../src/content/walkway.ts';

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

test('the stride stays shorter and wider than the standing pose at the same world scale', () => {
  const front = webpSize(readFileSync(files.front));
  const walk = webpSize(readFileSync(files.walk));
  assert.equal(front.height, HERO_REFERENCE_PIXEL_HEIGHT);
  for (const x of [620, 940, 1390, 1760]) {
    const scale = walkwayAt(x).height / HERO_REFERENCE_PIXEL_HEIGHT;
    assert.ok(walk.height * scale < front.height * scale);
    assert.ok(walk.width * scale > front.width * scale);
  }
});

test('stored reference documents the measured proportions', () => {
  const front = webpSize(readFileSync(files.front));
  assert.equal(front.width, 523);
  assert.equal(front.height, 1536);
});
