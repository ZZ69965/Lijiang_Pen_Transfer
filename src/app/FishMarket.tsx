import {
  MARKET_KINDS, findMarketKind,
  type MarketAction, type MarketSession,
} from '../content/market';

/**
 * Accessible UI for the fish-market story.
 *
 * All story logic lives in `src/content/market.ts` (等待→交谈→挑选→确认→完成 is
 * INTERNAL state). R2 removed the five-step progress bar: the stallholder's own
 * lines carry the progress, and the visitor is never asked to click "continue"
 * for a step that offers no new choice. This file never charges money and never
 * claims stock; purchase is a story simulation.
 */
export default function FishMarket({ session, onAction }: {
  session: MarketSession;
  onAction: (action: MarketAction) => void;
}) {
  const kind = findMarketKind(session.draftKindId);
  const remembered = session.record ? findMarketKind(session.record.kindId) : null;
  const picked = session.record?.outcome === 'bought';

  return (
    <div className="market-flow">
      <p className="market-line" role="status" data-sequence={session.sequence}>
        {session.reply || '摊主把竹篓往你面前挪了挪：「今早的鱼还带着水气，看看？」'}
      </p>

      {session.record && session.stage === 'waiting' && (
        <p className="market-record" role="note">
          {picked
            ? <>你已带走{remembered ? remembered.label : '一尾鱼'}，摊主记得你。</>
            : <>上一回你只是看了看，没有买。</>}
        </p>
      )}

      {/* One choice row at a time: what the stallholder offers right now. */}
      {session.stage === 'picking' && (
        <div className="market-kinds" role="group" aria-label="挑选渔获">
          {MARKET_KINDS.map((item) => (
            <button key={item.id} type="button" className={`market-kind ${session.draftKindId === item.id ? 'picked' : ''}`}
              aria-pressed={session.draftKindId === item.id}
              onClick={() => onAction({ type: 'pick', kindId: item.id })}>
              <strong>{item.label}</strong><small>{item.note}</small>
            </button>
          ))}
        </div>
      )}

      <div className="market-actions">
        {session.stage === 'waiting' && (
          <button type="button" className="market-main" onClick={() => onAction({ type: 'chat' })}>和摊主说话</button>
        )}
        {session.stage === 'picking' && (
          <button type="button" className="market-main" disabled={!kind}
            onClick={() => onAction({ type: 'ask-confirm' })}>
            {kind ? `就要${kind.label}` : '先挑一尾'}
          </button>
        )}
        {session.stage === 'confirming' && (
          <button type="button" className="market-main" onClick={() => onAction({ type: 'confirm' })}>
            确认带走{kind ? `（${kind.label}）` : ''}
          </button>
        )}
        {session.stage === 'completed' && (
          <button type="button" className="market-main" onClick={() => onAction({ type: 'reset' })}>再看看别的</button>
        )}
        {(session.stage === 'picking' || session.stage === 'confirming') && (
          <button type="button" className="market-cancel" onClick={() => onAction({ type: 'cancel' })}>
            {session.stage === 'confirming' ? '再挑一挑' : '暂不买了'}
          </button>
        )}
      </div>
    </div>
  );
}
