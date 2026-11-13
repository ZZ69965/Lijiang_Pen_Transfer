/**
 * 鱼市（fish market）event logic — 等待 → 交谈 → 挑选 → 确认 → 完成.
 *
 * This module is deliberately free of React, Pixi and browser APIs so the whole
 * lifecycle can be unit-tested in Node. It is a STORY simulation: no account, no
 * payment, no real price, no stock count. Species naming and local fishing lore
 * stay generic until reviewed material is available (see docs/INTERACTION_PLAN.md).
 */
export type MarketStage = 'waiting' | 'talking' | 'picking' | 'confirming' | 'completed';

/** What the visitor left with. Kept after closing so a revisit can recognise it. */
export type MarketOutcome = 'bought' | 'left';

export type MarketKind = {
  id: string;
  label: string;
  note: string;
};

/**
 * Neutral labels on purpose: these are demonstration goods, not a reviewed
 * species list. Real fish names/ecology copy must be verified before shipping.
 */
export const MARKET_KINDS: readonly MarketKind[] = [
  { id: 'small', label: '一尾小鱼', note: '当日小鲜，用竹叶包好。' },
  { id: 'large', label: '一尾大鱼', note: '分量更足，可带回家分食。' },
];

export type MarketSession = {
  stage: MarketStage;
  /** Result of the most recent COMPLETED visit; null before the first completion. */
  record: { outcome: MarketOutcome; kindId: string | null } | null;
  /** Choice held while confirming; cleared on cancel. */
  draftKindId: string | null;
  /** Short visible message for the current step. */
  reply: string;
  /** Bumped on every transition so the scene can fire one-shot feedback. */
  sequence: number;
};

export type MarketAction =
  | { type: 'open' }
  | { type: 'chat' }
  | { type: 'begin-picking' }
  | { type: 'pick'; kindId: string }
  | { type: 'ask-confirm' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'reset' };

export const MARKET_STEPS: readonly { stage: MarketStage; label: string }[] = [
  { stage: 'waiting', label: '等待' },
  { stage: 'talking', label: '交谈' },
  { stage: 'picking', label: '挑选' },
  { stage: 'confirming', label: '确认' },
  { stage: 'completed', label: '完成' },
];

export function createMarketSession(): MarketSession {
  return { stage: 'waiting', record: null, draftKindId: null, reply: '', sequence: 0 };
}

export function findMarketKind(kindId: string | null): MarketKind | null {
  return MARKET_KINDS.find((kind) => kind.id === kindId) ?? null;
}

/** Which stage each action is allowed from. Illegal actions are silently ignored. */
const ALLOWED_FROM: Record<MarketAction['type'], readonly MarketStage[]> = {
  open: ['waiting', 'completed'],
  chat: ['waiting'],
  'begin-picking': ['talking', 'waiting'],
  pick: ['picking'],
  'ask-confirm': ['picking'],
  confirm: ['confirming'],
  cancel: ['picking', 'confirming'],
  reset: ['completed', 'waiting', 'talking', 'picking', 'confirming'],
};

export function marketAllows(session: MarketSession, action: MarketAction): boolean {
  return ALLOWED_FROM[action.type].includes(session.stage);
}

/**
 * Apply one visitor action.
 *
 * Returns the SAME object when the action is illegal for the current stage, or
 * when it would not change anything. Callers can therefore guard against
 * repeated clicks by checking identity — a double click on "确认" can never
 * submit twice.
 */
export function applyMarketAction(session: MarketSession, action: MarketAction): MarketSession {
  if (!marketAllows(session, action)) return session;
  // Only the very first arrival at the finished state is a "new" completion;
  // reopening later starts a fresh visit (waiting) and must greet the visitor.
  if (action.type === 'open' && session.stage === 'waiting') return session;
  const next = (patch: Partial<MarketSession>): MarketSession => ({
    ...session,
    ...patch,
    sequence: session.sequence + 1,
  });

  switch (action.type) {
    case 'open':
      // A revisit after a completed visit greets the visitor with the memory of it.
      if (session.stage === 'completed' && session.record) {
        const kind = findMarketKind(session.record.kindId);
        return next({
          stage: 'waiting',
          reply: session.record.outcome === 'bought'
            ? `摊主：又见面了。上一回你带走的是${kind ? kind.label : '一尾鱼'}，可还合意？`
            : '摊主：又见面了。上回你只是看了看，今日的渔获还新鲜。',
        });
      }
      return next({ stage: 'waiting', reply: session.reply });
    case 'chat':
      // R2: greeting the stallholder lands straight on the fish he is offering.
      // `talking` used to need a second "看看篓里的渔获" click for no new choice,
      // so the stage is skipped instead of adding a step. It stays in the union
      // (and in `begin-picking`) for future dialogue that really needs a beat.
      return next({
        stage: 'picking',
        reply: '摊主把竹篓往前推了推：「都在篓里，慢慢挑。品类与渔法资料还在核实，这里先按演示品类介绍。」',
      });
    case 'begin-picking':
      return next({ stage: 'picking', reply: '摊主：看看这两尾，哪一尾合你的心意？' });
    case 'pick': {
      const kind = findMarketKind(action.kindId);
      if (!kind) return session;
      // Re-picking the item already in hand is a no-op, so a double click
      // cannot stack state or replay the feedback animation.
      if (session.draftKindId === kind.id) return session;
      return next({ stage: 'picking', draftKindId: kind.id, reply: `摊主：${kind.label}。${kind.note}要先确认吗？` });
    }
    case 'ask-confirm': {
      const kind = findMarketKind(session.draftKindId);
      if (!kind) return session;
      return next({ stage: 'confirming', reply: `摊主：这就把${kind.label}包好，确认带走？` });
    }
    case 'confirm': {
      const kind = findMarketKind(session.draftKindId);
      if (!kind) return session;
      return next({
        stage: 'completed',
        record: { outcome: 'bought', kindId: kind.id },
        reply: `摊主把${kind.label}用竹叶包好递给你。演示交易完成，不涉及金额或支付。`,
      });
    }
    case 'cancel':
      return next({
        stage: 'waiting',
        draftKindId: null,
        record: { outcome: 'left', kindId: null },
        reply: '你摆摆手，摊主把鱼放回篓里。随时可以再挑。',
      });
    case 'reset':
      return next({ stage: 'waiting', draftKindId: null, reply: '' });
    default:
      return session;
  }
}

/** Index of the current step for the visible progress trail; -1 when idle. */
export function marketStepIndex(session: MarketSession): number {
  return MARKET_STEPS.findIndex((step) => step.stage === session.stage);
}
