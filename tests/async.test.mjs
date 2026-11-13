import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncEpoch, AudioIntentQueue } from '../src/content/async.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('an old epoch cannot touch the scene it no longer owns', () => {
  const epoch = new AsyncEpoch();
  const first = epoch.begin();
  const second = epoch.begin();
  assert.equal(epoch.isCurrent(first), false, 'leaving the scene stales outstanding loads');
  assert.equal(epoch.isCurrent(second), true);
  epoch.invalidate();
  assert.equal(epoch.isCurrent(second), false, 'dispose stales everything');
});

test('audio: pause during a pending play wins when play resolves', async () => {
  let resolvedPlay;
  let playing = false;
  const play = () => new Promise((resolve) => {
    resolvedPlay = () => { playing = true; resolve(true); };
  });
  const pause = () => { playing = false; };
  const queue = new AudioIntentQueue(play, pause, () => playing);

  const playRequest = queue.request('play');
  await tick();
  assert.equal(playing, false, 'still awaiting the browser');

  // Visitor closes the card / switches time while play() is in flight.
  const pauseRequest = queue.request('pause');
  resolvedPlay();
  await Promise.all([playRequest, pauseRequest]);
  assert.equal(playing, false, 'late play() must not turn sound back on');
  assert.equal(await pauseRequest, false);
});

test('audio: close() while playing stops sound immediately', async () => {
  let playing = false;
  const queue = new AudioIntentQueue(
    async () => { playing = true; return true; },
    () => { playing = false; },
    () => playing,
  );
  await queue.request('play');
  assert.equal(playing, true);
  queue.close();
  assert.equal(playing, false);
  assert.equal(await queue.request('play'), false, 'a closed queue refuses to restart');
});

test('audio: rapid toggles coalesce to the final intent', async () => {
  let playing = false;
  let calls = 0;
  const queue = new AudioIntentQueue(
    async () => { calls += 1; await tick(); playing = true; return true; },
    () => { calls += 1; playing = false; },
    () => playing,
  );
  const a = queue.request('play');
  const b = queue.request('pause');
  const c = queue.request('play');
  await Promise.all([a, b, c]);
  assert.equal(playing, true, 'last intent (play) wins');
  assert.ok(calls <= 3, 'overlapping requests were coalesced, not replayed');
});

test('audio: a failing play still applies a pause queued while it was pending', async () => {
  let playing = false;
  let paused = 0;
  let thrown = 0;
  const queue = new AudioIntentQueue(
    async () => { await tick(); throwingPlay(); },
    () => { paused += 1; playing = false; },
    () => playing,
  );
  const throwingPlay = () => {
    thrown += 1;
    throw new Error('NotAllowedError');
  };
  // The visitor clicks play, then closes the card before the browser answers.
  const playRequest = queue.request('play').catch(() => 'rejected');
  await tick();
  queue.request('pause');
  const outcome = await playRequest;
  assert.equal(outcome, 'rejected', 'the caller learns the play failed');
  assert.equal(thrown, 1);
  assert.equal(playing, false);
});
