import { Check, Clock, Hand, PackageCheck, Pencil, Repeat, Tag, Undo2 } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Amount } from '../components/Brownie';
import type { Claim, Redemption, Reward, Task } from '../lib/types';
import { timeAgo } from '../lib/util';
import { useSheets } from './sheets';
import { AsyncButton } from '../components/ui';

/** Partner says they did a task you set → approve or send back. */
export function ReviewClaimCard({ claim }: { claim: Claim }) {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const p = state.partner?.display_name ?? 'Your partner';
  const task = d.taskById.get(claim.task_id);
  return (
    <article className="card action-card needs-you">
      <div className="ac-icon">
        <Hand size={20} />
      </div>
      <div className="ac-main">
        <p className="kicker">{p} says they did</p>
        <h3>{task?.title ?? 'A task'}</h3>
        {claim.note && <p className="quote">“{claim.note}”</p>}
        <p className="meta">{timeAgo(claim.created_at)}</p>
      </div>
      <div className="ac-actions">
        <button className="btn btn-ghost sm" onClick={() => sheets.open({ kind: 'decline', claim })}>
          Not yet
        </button>
        <AsyncButton
          className="btn btn-caramel sm"
          onClick={() => act((b) => b.reviewClaim(claim.id, true, ''), { success: `${claim.points} brownies for ${p}!`, celebrate: true })}
        >
          <Check size={16} /> Approve <Amount n={claim.points} sign size="sm" />
        </AsyncButton>
      </div>
    </article>
  );
}

/** Partner cashed in one of their wishes → you deliver it. */
export function DeliverCard({ redemption }: { redemption: Redemption }) {
  const { state, act } = useLoaded();
  const sheets = useSheets();
  const p = state.partner?.display_name ?? 'Your partner';
  return (
    <article className="card action-card needs-you">
      <div className="ac-emoji">{redemption.emoji}</div>
      <div className="ac-main">
        <p className="kicker">{p} cashed in</p>
        <h3>{redemption.title}</h3>
        <p className="meta">
          Paid <Amount n={redemption.price} size="sm" /> · {timeAgo(redemption.created_at)}
        </p>
      </div>
      <div className="ac-actions">
        <button
          className="btn btn-ghost sm"
          onClick={() =>
            sheets.open({
              kind: 'confirm',
              title: 'Can’t do this one?',
              body: (
                <p>
                  {p} gets their <Amount n={redemption.price} size="sm" /> back for “{redemption.title}”.
                </p>
              ),
              confirmLabel: 'Cancel & refund',
              danger: true,
              onConfirm: () => act((b) => b.cancelRedemption(redemption.id), { success: 'Refunded' }),
            })
          }
        >
          Can’t right now
        </button>
        <AsyncButton
          className="btn btn-caramel sm"
          onClick={() => act((b) => b.deliverRedemption(redemption.id), { success: 'Delivered with love', celebrate: true })}
        >
          <PackageCheck size={16} /> Delivered
        </AsyncButton>
      </div>
    </article>
  );
}

/** Partner wished for something and you haven't priced it yet. */
export function PriceCard({ reward }: { reward: Reward }) {
  const { state } = useLoaded();
  const sheets = useSheets();
  const p = state.partner?.display_name ?? 'Your partner';
  return (
    <article className="card action-card needs-you">
      <div className="ac-emoji">{reward.emoji}</div>
      <div className="ac-main">
        <p className="kicker">{p} wishes for</p>
        <h3>{reward.title}</h3>
        {reward.details && <p className="quote">“{reward.details}”</p>}
      </div>
      <div className="ac-actions">
        <button className="btn btn-caramel sm" onClick={() => sheets.open({ kind: 'price', reward })}>
          <Tag size={16} /> Set a price
        </button>
      </div>
    </article>
  );
}

/** Something you're waiting on (no action needed). */
export function WaitingRow({ emoji, kicker, title, onUndo, undoLabel = 'Undo' }: { emoji?: string; kicker: string; title: string; onUndo?: () => void; undoLabel?: string }) {
  return (
    <div className="waiting-row">
      <span className="waiting-icon">{emoji ?? <Clock size={16} />}</span>
      <div className="waiting-main">
        <span className="kicker">{kicker}</span>
        <span className="waiting-title">{title}</span>
      </div>
      {onUndo && (
        <button className="link" onClick={onUndo}>
          <Undo2 size={14} /> {undoLabel}
        </button>
      )}
    </div>
  );
}

export function RepeatTag({ repeatable }: { repeatable: boolean }) {
  return <span className="tag">{repeatable ? <><Repeat size={12} /> Again &amp; again</> : 'Just once'}</span>;
}

/** A task set FOR you. */
export function MyTaskCard({ task }: { task: Task }) {
  const { state, d, act } = useLoaded();
  const p = state.partner?.display_name ?? 'your partner';
  const claim = d.pendingClaimByTask.get(task.id);
  return (
    <article className={`card task-card ${claim ? 'is-waiting' : ''}`}>
      <div className="tc-top">
        <div className="tc-text">
          <h3>{task.title}</h3>
          {task.details && <p>{task.details}</p>}
        </div>
        <Amount n={task.points} size="lg" />
      </div>
      <div className="tc-bottom">
        <RepeatTag repeatable={task.repeatable} />
        {claim ? (
          <div className="tc-status">
            <span className="pulse-dot" /> Waiting for {p}
            <AsyncButton className="link" onClick={() => act((b) => b.withdrawClaim(claim.id))}>
              Undo
            </AsyncButton>
          </div>
        ) : (
          <AsyncButton className="btn btn-caramel sm" onClick={() => act((b) => b.claimTask(task.id, ''), { success: `Sent to ${p} for approval` })}>
            <Check size={16} /> I did it!
          </AsyncButton>
        )}
      </div>
    </article>
  );
}

/** A task YOU set for your partner. */
export function TheirTaskCard({ task }: { task: Task }) {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const p = state.partner?.display_name ?? 'Your partner';
  const claim = d.pendingClaimByTask.get(task.id);
  return (
    <article className={`card task-card ${claim ? 'needs-you' : ''}`}>
      <div className="tc-top">
        <div className="tc-text">
          <h3>{task.title}</h3>
          {task.details && <p>{task.details}</p>}
        </div>
        <Amount n={task.points} size="lg" />
      </div>
      {claim ? (
        <div className="review-bar">
          <span>
            <strong>{p} says it’s done!</strong>
            {claim.note && <em> “{claim.note}”</em>}
          </span>
          <div className="review-actions">
            <button className="btn btn-ghost sm" onClick={() => sheets.open({ kind: 'decline', claim })}>
              Not yet
            </button>
            <AsyncButton
              className="btn btn-caramel sm"
              onClick={() => act((b) => b.reviewClaim(claim.id, true, ''), { success: `${claim.points} brownies for ${p}!`, celebrate: true })}
            >
              <Check size={16} /> Approve
            </AsyncButton>
          </div>
        </div>
      ) : (
        <div className="tc-bottom">
          <RepeatTag repeatable={task.repeatable} />
          <button className="btn btn-ghost sm" onClick={() => sheets.open({ kind: 'task', task })}>
            <Pencil size={14} /> Edit
          </button>
        </div>
      )}
    </article>
  );
}
