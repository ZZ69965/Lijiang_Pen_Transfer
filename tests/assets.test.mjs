import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_ASSETS, POSES, SCENES, assetKey, criticalPosesFor, planAssets,
  resolvePose, sceneIsReady, timesUsingScene, otherSceneVariants,
} from '../src/content/assets.ts';
import { TIMES, artworkForTime } from '../src/content/places.ts';

test('first entry waits only for the current artwork plus the minimal pose set', () => {
  for (const { id: time } of TIMES) {
    const { critical, deferred } = planAssets(time);
    const currentScene = `scene:${artworkForTime(time)}`;
    assert.ok(critical.some((asset) => asset.key === currentScene), `${time} requires its own painting`);
    assert.equal(critical.filter((asset) => asset.kind === 'scene').length, 1,
      `${time} must not block on the other two paintings`);
    // front (idle) and walk (first interaction) only; song additionally for night.
    const expectedPoses = time === 'night' ? ['front', 'walk', 'song'] : ['front', 'walk'];
    assert.deepEqual(critical.filter((a) => a.kind === 'pose').map((a) => a.id).sort(), [...expectedPoses].sort());
    assert.ok(critical.every((asset) => asset.required), 'critical assets are required');
    assert.ok(deferred.every((asset) => !asset.required), 'deferred assets are optional');
  }
});

test('critical + deferred together cover every scene and pose exactly once', () => {
  for (const { id: time } of TIMES) {
    const { critical, deferred } = planAssets(time);
    const keys = [...critical, ...deferred].map((asset) => asset.key);
    assert.equal(new Set(keys).size, keys.length, 'no duplicate downloads');
    assert.equal(keys.length, ALL_ASSETS.length, 'nothing silently dropped');
    assert.equal(ALL_ASSETS.length, SCENES.length + POSES.length);
  }
});

test('background order loads the other paintings before leftover poses', () => {
  const { deferred } = planAssets('dusk');
  const kinds = deferred.map((asset) => asset.kind);
  const lastScene = kinds.lastIndexOf('scene');
  const firstPose = kinds.indexOf('pose');
  assert.ok(lastScene === -1 || firstPose === -1 || lastScene < firstPose, 'scenes prefetch first');
  assert.deepEqual(otherSceneVariants('dusk'), ['day', 'night']);
});

test('morning and noon share one cached day painting (no duplicate download)', () => {
  const morning = planAssets('morning').critical.map((a) => a.key);
  const noon = planAssets('noon').critical.map((a) => a.key);
  assert.ok(morning.includes('scene:day') && noon.includes('scene:day'));
  assert.deepEqual(timesUsingScene('day'), ['morning', 'noon']);
  assert.equal(timesUsingScene('dusk').length, 1);
  assert.equal(timesUsingScene('night').length, 1);
});

test('ready check reflects cache, not the requested time slot', () => {
  assert.equal(sceneIsReady(['day'], 'morning'), true);
  assert.equal(sceneIsReady(['day'], 'noon'), true, 'noon reuses the day cache');
  assert.equal(sceneIsReady(['day'], 'dusk'), false);
  assert.equal(sceneIsReady(['day', 'night'], 'night'), true);
});

test('pose fallback keeps a walker drawable when optional poses are missing', () => {
  assert.equal(resolvePose('side', ['front']), 'front');
  assert.equal(resolvePose('song', ['front', 'side']), 'front');
  assert.equal(resolvePose('walk', ['front']), 'front');
  assert.equal(resolvePose('back', ['front', 'back']), 'back');
  assert.equal(resolvePose('walk', ['front', 'walk']), 'walk');
  // Nothing loaded at all: return the request so the caller can report it.
  assert.equal(resolvePose('song', []), 'song');
});

test('critical pose set is minimal and stable', () => {
  assert.deepEqual(criticalPosesFor('morning'), ['front', 'walk']);
  assert.deepEqual(criticalPosesFor('dusk'), ['front', 'walk']);
  assert.deepEqual(criticalPosesFor('night'), ['front', 'walk', 'song']);
  assert.equal(assetKey('scene', 'day'), 'scene:day');
});
