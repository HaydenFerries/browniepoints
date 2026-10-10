import { Clock, Pencil, Plus } from 'lucide-react';
import { useLoaded } from '../app/store';
import { useSessionState } from '../app/useSessionState';
import { Amount } from '../components/Brownie';
import { Empty, Segmented } from '../components/ui';
import type { Reward } from '../lib/types';
import { timeAgo } from '../lib/util';
import { DeliverCard, WaitingRow } from './cards';
import { useSheets } from './sheets';

export function Treats() {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const p = state.partner!.display_name;
  const [view, setView] = useSessionState<'mine' | 'theirs'>('bp-treats-view', 'mine');
  const theirAlerts = d.toDeliver.length + d.toPrice.length;
  const delivered = state.redemptions.filter((r) => r.status === 'delivered');

  return (
    <div className="stack">
      <header className="screen-head">
        <h1 className="screen-title">Rewards</h1>
        <p className="screen-sub">
          {view === 'mine'
            ? `Your wishlist. ${p} sets the prices, you spend your brownies.`
            : `${p}’s wishlist. You decide what each one costs.`}
        </p>
      </header>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'mine', label: <>Your wishlist</> },
          {
            value: 'theirs',
            label: (
              <>
                {p}’s {theirAlerts > 0 && <span className="seg-count alert">{theirAlerts}</span>}
              </>
            ),
          },
        ]}
      />

      {view === 'mine' ? (
        <div className="stack-sm">
          <div className="balance-strip">
            <span>You have</span>
            <Amount n={d.myBalance} size="lg" />
            <span>to spend</span>
          </div>
          {d.owedToMe.length > 0 && (
            <div className="card waiting-card">
              {d.owedToMe.map((r) => (
                <WaitingRow
                  key={r.id}
                  emoji={r.emoji}
                  kicker={`${p} owes you · ${timeAgo(r.created_at)}`}
                  title={r.title}
                  undoLabel="Cancel"
                  onUndo={() =>
                    sheets.open({
                      kind: 'confirm',
                      title: 'Cancel this treat?',
                      body: (
                        <p>
                          You’ll get <Amount n={r.price} size="sm" /> back for “{r.title}”.
                        </p>
                      ),
                      confirmLabel: 'Cancel & refund',
                      danger: true,
                      onConfirm: () => act((b) => b.cancelRedemption(r.id), { success: 'Refunded' }),
                    })
                  }
                />
              ))}
            </div>
          )}
          {d.myWishes.map((r) => (
            <MyWishCard key={r.id} reward={r} />
          ))}
          {d.myWishes.length === 0 && (
            <Empty title="What would make you melt?">Add things you’d love from {p}: a massage, breakfast in bed, a night off…</Empty>
          )}
          <button className="btn btn-ghost block" onClick={() => sheets.open({ kind: 'wish' })}>
            <Plus size={18} /> Add a wish
          </button>
        </div>
      ) : (
        <div className="stack-sm">
          {d.toDeliver.map((r) => (
            <DeliverCard key={r.id} redemption={r} />
          ))}
          {[...d.partnerWishes]
            .sort((a, b) => Number(a.price != null) - Number(b.price != null))
            .map((r) => (
              <TheirWishCard key={r.id} reward={r} />
            ))}
          {d.partnerWishes.length === 0 && <Empty title={`${p} hasn’t wished for anything yet`}>When they do, you’ll set the price here.</Empty>}
        </div>
      )}

      {delivered.length > 0 && (
        <details className="done-list">
          <summary>
            Enjoyed treats <span className="seg-count">{delivered.length}</span>
          </summary>
          <ul>
            {delivered.map((r) => (
              <li key={r.id}>
                <span className="done-title">
                  {r.emoji} {r.title} <em>· {r.redeemed_by === d.myId ? 'you' : p}</em>
                </span>
                <Amount n={r.price} size="sm" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function MyWishCard({ reward }: { reward: Reward }) {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const p = state.partner!.display_name;
  const price = reward.price;
  const canAfford = price != null && d.myBalance >= price;
  const pct = price ? Math.min(100, Math.round((Math.max(0, d.myBalance) / price) * 100)) : 0;

  return (
    <article className={`card wish-card ${canAfford ? 'affordable' : ''}`}>
      <div className="wc-emoji">{reward.emoji}</div>
      <div className="wc-main">
        <div className="wc-title-row">
          <h3>{reward.title}</h3>
          <button className="icon-btn" onClick={() => sheets.open({ kind: 'wish', reward })} aria-label={`Edit ${reward.title}`}>
            <Pencil size={17} />
          </button>
        </div>
        {reward.details && <p className="wc-details">{reward.details}</p>}
        {price == null ? (
          <p className="wc-wait">
            <Clock size={14} /> Waiting for {p} to set a price
          </p>
        ) : (
          <>
            <div className="progress" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="wc-foot">
              <span className={canAfford ? 'ok' : 'muted'}>{canAfford ? 'You can afford this!' : `${price - d.myBalance} more to go`}</span>
              <button
                className="btn btn-caramel sm"
                disabled={!canAfford}
                onClick={() =>
                  sheets.open({
                    kind: 'confirm',
                    title: `Cash in “${reward.title}”?`,
                    body: (
                      <p>
                        This spends <Amount n={price} size="sm" /> and lets {p} know it’s time to deliver.
                      </p>
                    ),
                    confirmLabel: 'Cash in',
                    onConfirm: () => act((b) => b.redeemReward(reward.id), { success: `Enjoy! ${p} has been told.`, celebrate: true }),
                  })
                }
              >
                Cash in <Amount n={price} size="sm" />
              </button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

function TheirWishCard({ reward }: { reward: Reward }) {
  const sheets = useSheets();
  const priced = reward.price != null;
  return (
    <article className={`card wish-card ${priced ? '' : 'needs-you'}`}>
      <div className="wc-emoji">{reward.emoji}</div>
      <div className="wc-main">
        <h3>{reward.title}</h3>
        {reward.details && <p className="wc-details">{reward.details}</p>}
        <div className="wc-foot">
          {priced ? <Amount n={reward.price!} size="lg" /> : <span className="tag tag-alert">No price yet</span>}
          <button className={`btn sm ${priced ? 'btn-ghost' : 'btn-caramel'}`} onClick={() => sheets.open({ kind: 'price', reward })}>
            {priced ? 'Change price' : 'Set a price'}
          </button>
        </div>
      </div>
    </article>
  );
}
