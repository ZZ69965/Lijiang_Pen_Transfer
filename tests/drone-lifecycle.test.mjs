import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'pixi.js';
import { NightDroneShow } from '../src/engine/NightDroneShow.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('late artwork cannot reappear after the visitor closes it; revisiting reuses the texture', async () => {
  const request = deferred();
  let calls = 0;
  const show = new NightDroneShow(() => {}, () => { calls += 1; return request.promise; });
  assert.equal(calls, 0, 'constructing the world never downloads drone art');
  show.setArtwork('elephant');
  assert.equal(show.status.state, 'loading');
  show.setArtwork(null);
  request.resolve(Texture.EMPTY);
  await flush();
  assert.equal(show.status.state, 'idle');
  assert.equal(show.container.visible, false);
  show.setArtwork('elephant');
  assert.equal(show.status.state, 'ready');
  assert.equal(calls, 1);
  show.update(0, true);
  assert.equal(show.container.alpha, 1, 'reduced motion reveals a static image');
  show.dispose();
  show.container.destroy({ children: true });
});

test('switching while loading never displays the previous selection', async () => {
  const requests = { elephant: deferred(), festival: deferred() };
  const show = new NightDroneShow(() => {}, (id) => requests[id].promise);
  show.setArtwork('elephant');
  show.setArtwork('festival');
  requests.festival.resolve(Texture.EMPTY);
  await flush();
  requests.elephant.resolve(Texture.EMPTY);
  await flush();
  assert.deepEqual(show.status, { id: 'festival', state: 'ready' });
  show.dispose();
  show.container.destroy({ children: true });
});

test('failed artwork is retryable without destroying the scene', async () => {
  let calls = 0;
  const show = new NightDroneShow(() => {}, () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(Texture.EMPTY);
  });
  show.setArtwork('elephant');
  await flush();
  assert.equal(show.status.state, 'error');
  assert.equal(show.container.visible, false);
  show.retry();
  await flush();
  assert.equal(show.status.state, 'ready');
  assert.equal(show.container.visible, true);
  show.dispose();
  show.container.destroy({ children: true });
});

test('disposing an in-flight image prevents later scene mutations', async () => {
  const request = deferred();
  let updates = 0;
  const show = new NightDroneShow(() => { updates += 1; }, () => request.promise);
  show.setArtwork('elephant');
  show.dispose();
  const before = updates;
  show.container.destroy({ children: true });
  request.resolve(Texture.EMPTY);
  await flush();
  assert.equal(updates, before);
});
