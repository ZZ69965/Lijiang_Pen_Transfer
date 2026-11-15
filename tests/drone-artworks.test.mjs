import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRONE_ARTWORKS, droneArtworkFrame } from '../src/content/droneArtworks.ts';
import { planAssets } from '../src/content/assets.ts';

test('uploaded artwork stays optional to entering every time period', () => {
  for (const time of ['morning', 'noon', 'dusk', 'night']) {
    const plan = planAssets(time);
    for (const asset of [...plan.critical, ...plan.deferred]) {
      assert.ok(!DRONE_ARTWORKS.some((artwork) => artwork.file === asset.file),
        'drone art must load on demand, not during panorama entry');
    }
  }
});

test('each artwork fits the viewport without cropping or changing the native aspect', () => {
  for (const [width, height] of [[1280, 720], [390, 844], [844, 390]]) {
    for (const zoom of [0.72, 1, 1.65]) {
      const worldY = (height - 724 * zoom) / 2;
      const frame = droneArtworkFrame(width, height, zoom, worldY);
      assert.ok(frame.width > 0 && frame.height > 0);
      assert.ok(frame.width * zoom <= width * 0.84 + 0.01);
      assert.ok(frame.y * zoom + worldY >= 76 - 0.01);
      assert.ok((frame.y + frame.height) * zoom + worldY <= height - 170);
      assert.ok(frame.x >= 0 && frame.x + frame.width <= 2172);
      assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < 0.001);
    }
  }
});
