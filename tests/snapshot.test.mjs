import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT_VERSION, createSnapshot, readSnapshot, restingInput } from '../src/content/snapshot.ts';

const base = {
  time: 'noon',
  mode: 'free',
  place: 'yangbridge',
  heroX: 1690,
  facing: -1,
  cameraCentre: 1712,
  zoom: 1.13,
  marketRecord: { outcome: 'bought', kindId: 'large' },
};

test('a snapshot round-trips every field the finale/prologue must restore', () => {
  const saved = createSnapshot(base, 1763000000000);
  assert.equal(saved.version, SNAPSHOT_VERSION);
  const restored = readSnapshot(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored, saved);
  assert.equal(restored.heroX, 1690);
  assert.equal(restored.facing, -1);
  assert.equal(restored.cameraCentre, 1712);
  assert.equal(restored.zoom, 1.13);
  assert.deepEqual(restored.marketRecord, { outcome: 'bought', kindId: 'large' });
});

test('restoring never resumes an activity: the walker starts at rest', () => {
  const saved = createSnapshot(base);
  assert.deepEqual(restingInput(), { walking: 0 });
  // No field in the snapshot can express "still holding the walk key" or audio.
  for (const forbidden of ['walking', 'playing', 'music', 'heldKeys']) {
    assert.equal(forbidden in saved, false, `${forbidden} must not be part of a position snapshot`);
  }
});

test('malformed or outdated snapshots degrade to null instead of throwing', () => {
  assert.equal(readSnapshot(null), null);
  assert.equal(readSnapshot(undefined), null);
  assert.equal(readSnapshot('noon'), null);
  assert.equal(readSnapshot({ ...createSnapshot(base), version: SNAPSHOT_VERSION + 1 }), null, 'old format rejected');
  assert.equal(readSnapshot({ ...createSnapshot(base), heroX: Number.NaN }), null);
  assert.equal(readSnapshot({ ...createSnapshot(base), zoom: 0 }), null);
  assert.equal(readSnapshot({ ...createSnapshot(base), facing: 0 }), null);
  assert.equal(readSnapshot({ ...createSnapshot(base), mode: 'cinema' }), null);
  assert.equal(readSnapshot({ ...createSnapshot(base), time: 'midnight' }), null);
  assert.equal(readSnapshot({ ...createSnapshot(base), marketRecord: { outcome: 'stolen' } }), null);
});

test('a snapshot without a fish-market result is valid (visitor never opened it)', () => {
  const saved = createSnapshot({ ...base, marketRecord: null });
  assert.equal(readSnapshot(saved).marketRecord, null);
});
