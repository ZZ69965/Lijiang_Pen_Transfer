import {
  MARKET_KINDS, MARKET_STEPS, findMarketKind, marketStepIndex,
  type MarketAction, type MarketSession,
} from '../content/market';

/**
 * Accessible UI for the fish-market story. All story logic lives in
 * `src/content/market.ts`; this file only renders the current stage and
 * forwards one action per click. Nothing here charges money or claims stock.
 */
export default function FishMarket({ session, onAction }: {
  session: MarketSession;
  onAction: (action: MarketAction) => void;
}) {
  const stepIndex = marketStepIndex(session);
  const kind = findMarketKind(session.draftKindId);
  const remembered = session.record ? findMarketKind(session.record.kindId) : null;
  const busy = session.stage === 'completed';

  return (
    <div className="market-flow">
      <ol className="market-steps" aria-label="购买流程">
        {MARKET_STEPS.map((step, index) => (
          <li key={step.stage}
            className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''}
            aria-current={index === stepIndex ? 'step' : undefined}>
            <span aria-hidden="true">{index < stepIndex ? '✓' : index + 1}</span>{step.label}
          </li>
        ))}
      </ol>

      {session.record && session.stage === 'waiting' && (
        <p className="market-record" role="note">
          上一回：{session.record.outcome === 'bought'
            ? `带走${remembered ? remembered.label : '一尾鱼'}`
            : '只是看了看，没有买'}
        </p>
      )}

      <div className="market-actions">
        {session.stage === 'waiting' && (
          <button type="button" onClick={() => onAction({ type: 'chat' })}>向摊主打听今日渔获</button>
        )}
        {session.stage === 'talking' && (
          <button type="button" onClick={() => onAction({ type: 'begin-picking' })}>看看篓里的渔获</button>
        )}
        {session.stage === 'picking' && (
          <>
            {MARKET_KINDS.map((item) => (
              <button key={item.id} type="button" className={`market-kind ${session.draftKindId === item.id ? 'picked' : ''}`}
                aria-pressed={session.draftKindId === item.id}
                onClick={() => onAction({ type: 'pick', kindId: item.id })}>
                <strong>{item.label}</strong><small>{item.note}</small>
              </button>
            ))}
            <button type="button" className="market-confirm" disabled={!kind}
              onClick={() => onAction({ type: 'ask-confirm' })}>
              {kind ? `就选${kind.label}，确认带走` : '先挑一尾'}
            </button>
            <button type="button" className="market-cancel" onClick={() => onAction({ type: 'cancel' })}>暂不买了</button>
          </>
        )}
        {session.stage === 'confirming' && (
          <>
            <button type="button" className="market-confirm" onClick={() => onAction({ type: 'confirm' })}>
              确认带走{kind ? `（${kind.label}）` : ''}
            </button>
            <button type="button" className="market-cancel" onClick={() => onAction({ type: 'cancel' })}>再挑一挑</button>
          </>
        )}
        {busy && (
          <button type="button" onClick={() => onAction({ type: 'reset' })}>再看看别的渔获</button>
        )}
      </div>

      <p className="market-reply" role="status" data-sequence={session.sequence}>
        {session.reply || '摊主抬头看了你一眼，等你开口。'}
      </p>
    </div>
  );
}
