import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMarketAction, createMarketSession, findMarketKind, marketAllows, marketStepIndex, MARKET_STEPS,
} from '../src/content/market.ts';

function run(...actions) {
  return actions.reduce((session, action) => applyMarketAction(session, action), createMarketSession());
}

test('the happy path reaches the fish in one click and completes in four', () => {
  let s = createMarketSession();
  assert.equal(s.stage, 'waiting');
  const stages = [s.stage];
  for (const action of [
    { type: 'chat' },
    { type: 'pick', kindId: 'small' },
    { type: 'ask-confirm' },
    { type: 'confirm' },
  ]) {
    s = applyMarketAction(s, action);
    stages.push(s.stage);
  }
  // R2 removed the "talking" beat: greeting the stallholder lands on the fish,
  // because that intermediate step offered no new choice.
  assert.deepEqual(stages, ['waiting', 'picking', 'picking', 'confirming', 'completed']);
  assert.deepEqual(s.record, { outcome: 'bought', kindId: 'small' });
  assert.match(s.reply, /小鱼/);
});

test('the internal stage stays available for future dialogue beats', () => {
  // `begin-picking` from `waiting` still works, so a later scripted
  // conversation can insert a `talking` beat without changing the machine.
  const s = run({ type: 'begin-picking' });
  assert.equal(s.stage, 'picking');
  assert.ok(MARKET_STEPS.some((step) => step.stage === 'talking'));
});

test('every stage transition produces a visible reply and bumps the sequence', () => {
  const s = run({ type: 'chat' });
  assert.ok(s.reply.length > 0, 'visible feedback for the current step');
  assert.equal(s.sequence, 1, 'one-shot feedback fired once');
  assert.equal(marketStepIndex(s), 2);
  assert.deepEqual(MARKET_STEPS.map((step) => step.label), ['等待', '交谈', '挑选', '确认', '完成']);
});

test('cancel clears the draft and records a "left" outcome', () => {
  const s = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'large' }, { type: 'cancel' });
  assert.equal(s.stage, 'waiting');
  assert.equal(s.draftKindId, null);
  assert.deepEqual(s.record, { outcome: 'left', kindId: null });
  assert.match(s.reply, /放回篓/);
});

test('cancel is also allowed after confirm is requested but before confirming', () => {
  const s = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'large' }, { type: 'ask-confirm' }, { type: 'cancel' });
  assert.equal(s.stage, 'waiting');
  assert.deepEqual(s.record, { outcome: 'left', kindId: null });
});

test('repeated confirmation cannot submit twice', () => {
  const before = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'small' }, { type: 'ask-confirm' });
  const first = applyMarketAction(before, { type: 'confirm' });
  const second = applyMarketAction(first, { type: 'confirm' });
  const third = applyMarketAction(second, { type: 'confirm' });
  assert.equal(first.stage, 'completed');
  assert.equal(second, first, 'identical object returned: no second submission');
  assert.equal(third, first);
  assert.equal(first.sequence, before.sequence + 1, 'sequence advanced exactly once');
});

test('illegal actions are ignored and return the same session object', () => {
  const fresh = createMarketSession();
  // `begin-picking` IS legal from waiting (see the staged-beat test above), so
  // the illegal set is everything that needs an earlier decision.
  for (const action of [{ type: 'confirm' }, { type: 'pick', kindId: 'small' }, { type: 'ask-confirm' }]) {
    assert.equal(applyMarketAction(fresh, action), fresh, `${action.type} cannot run from waiting`);
  }
  // Picking an unknown kind is rejected without changing stage.
  const picking = run({ type: 'chat' }, { type: 'begin-picking' });
  assert.equal(applyMarketAction(picking, { type: 'pick', kindId: 'dragon' }), picking);
  // Confirming with no draft is rejected.
  assert.equal(applyMarketAction(picking, { type: 'ask-confirm' }), picking);
});

test('double-clicking "chat" or "pick" does not corrupt the session', () => {
  const s1 = applyMarketAction(createMarketSession(), { type: 'chat' });
  const s2 = applyMarketAction(s1, { type: 'chat' });
  assert.equal(s2, s1, 'second chat click ignored while already at the fish');
  const p1 = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'small' });
  const p2 = applyMarketAction(p1, { type: 'pick', kindId: 'small' });
  assert.equal(p2, p1, 'same pick does not stack state (still picking)');
  assert.equal(p1.record, null, 'picking alone never records a result');
});

test('a revisit after completion recognises the earlier result', () => {
  const done = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'large' }, { type: 'ask-confirm' }, { type: 'confirm' });
  const revisit = applyMarketAction(done, { type: 'open' });
  assert.equal(revisit.stage, 'waiting');
  assert.deepEqual(revisit.record, { outcome: 'bought', kindId: 'large' }, 'record survives the revisit');
  assert.match(revisit.reply, /大鱼/);
  assert.match(revisit.reply, /又见面/);

  // And the visitor can buy again through a fresh loop.
  const again = [
    { type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'small' }, { type: 'ask-confirm' },
  ].reduce((session, action) => applyMarketAction(session, action), revisit);
  const completed = applyMarketAction(again, { type: 'confirm' });
  assert.deepEqual(completed.record, { outcome: 'bought', kindId: 'small' });
});

test('revisit after leaving keeps the "left" record and does not claim a purchase', () => {
  const left = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'cancel' });
  assert.equal(left.record.outcome, 'left');
  // Cancelling already gives visible feedback; reopening cannot invent a sale.
  assert.match(left.reply, /放回篓/);
  const reopened = applyMarketAction(left, { type: 'open' });
  assert.deepEqual(reopened.record, { outcome: 'left', kindId: null });
  assert.equal(reopened.stage, 'waiting');
});

test('switching time mid-flow can reset the session without losing the last result', () => {
  const mid = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'small' });
  const reset = applyMarketAction(mid, { type: 'reset' });
  assert.equal(reset.stage, 'waiting');
  assert.equal(reset.draftKindId, null);
  assert.equal(reset.record, null, 'unfinished flow leaves no result');

  const afterPurchase = run({ type: 'chat' }, { type: 'begin-picking' }, { type: 'pick', kindId: 'small' }, { type: 'ask-confirm' }, { type: 'confirm' });
  const resetAfter = applyMarketAction(afterPurchase, { type: 'reset' });
  assert.equal(resetAfter.stage, 'waiting');
  assert.deepEqual(resetAfter.record, { outcome: 'bought', kindId: 'small' }, 'completed result is remembered');
});

test('allowed-from table stays consistent with the step order', () => {
  const order = MARKET_STEPS.map((step) => step.stage);
  assert.equal(marketAllows(createMarketSession(), { type: 'chat' }), true);
  assert.equal(marketAllows(createMarketSession(), { type: 'begin-picking' }), true);
  assert.equal(marketAllows(createMarketSession(), { type: 'confirm' }), false);
  assert.equal(order.indexOf('confirming') > order.indexOf('picking'), true);
  assert.equal(findMarketKind('small')?.label, '一尾小鱼');
  assert.equal(findMarketKind(null), null);
  assert.equal(findMarketKind('dragon'), null);
});
