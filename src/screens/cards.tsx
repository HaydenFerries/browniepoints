import type { ReactNode } from 'react';
import { Check, Clock, Flame, Hand, Handshake, Moon, PackageCheck, Pause, Pencil, Play, Repeat, Tag, Undo2, Users } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Amount } from '../components/Brownie';
import type { Claim, Redemption, Reward, Task } from '../lib/types';
import { timeAgo } from '../lib/util';
import { basePrice, canManage, durationLabel, floorValue, freshness, graceLeft, isActive, taskValue } from '../lib/tasks';
import { useNow } from '../app/useNow';
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

const freshLabel = (f: number) => (f > 0.66 ? 'Fresh' : f > 0.33 ? 'Cooling' : f > 0 ? 'Going stale' : 'Stale');

/**
 * Any task: one set for you, one you set for your partner, or a shared one.
 * `handle` is the drag handle when the card sits in a reorderable list.
 */
export function TaskCard({ task, handle }: { task: Task; handle?: ReactNode }) {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const now = useNow();
  const p = state.partner?.display_name ?? 'your partner';
  const partnerId = d.partnerId ?? '';
  const me = d.myId;
  const claim = d.pendingClaimByTask.get(task.id);
  const active = isActive(task);
  const iDoIt = !!task.shared || task.assigned_to === me;
  const iSetIt = !task.shared && task.created_by === me;
  const manage = canManage(task, me);
  const claimedByMe = claim?.claimed_by === me;
  const claimedByPartner = !!claim && !claimedByMe;
  const fresh = freshness(task, now);
  const myValue = taskValue(task, me, now);
  const partnerValue = taskValue(task, partnerId, now);

  return (
    <article
      className={`card task-card ${claimedByPartner ? 'needs-you' : ''} ${claimedByMe ? 'is-waiting' : ''} ${active ? '' : 'is-resting'}`}
    >
      <div className="tc-top">
        {handle}
        <div className="tc-text">
          <h3>{task.title}</h3>
          {task.details && <p>{task.details}</p>}
        </div>
        {task.shared ? (
          <div className="shared-prices">
            <span>
              <small>You</small> <Amount n={myValue} size="md" />
            </span>
            <span>
              <small>{p}</small> <Amount n={partnerValue} size="md" />
            </span>
          </div>
        ) : (
          <Amount n={iSetIt ? partnerValue : myValue} size="lg" />
        )}
      </div>

      {task.decay_hours ? (
        <div className="fresh-meter" title={`Goes stale over ${durationLabel(task.decay_hours)}`}>
          <div className="fresh-track">
            <div className="fresh-fill" style={{ width: `${Math.round(fresh * 100)}%` }} />
          </div>
          <span>
            {graceLeft(task, now) > 0 ? `Fresh · cools in ${durationLabel(Math.ceil(graceLeft(task, now)))}` : freshLabel(fresh)}
            {(iSetIt ? partnerValue : myValue) < basePrice(task, iSetIt ? partnerId : me) && ` · was ${basePrice(task, iSetIt ? partnerId : me)}`}
            {fresh > 0 && ` · bottoms out at ${floorValue(task, iSetIt ? partnerId : me)}`}
          </span>
        </div>
      ) : null}

      {claimedByPartner ? (
        <div className="review-bar">
          <span>
            <strong>
              {p} says it’s done! <Amount n={claim!.points} sign size="sm" />
            </strong>
            {claim!.note && <em> “{claim!.note}”</em>}
          </span>
          <div className="review-actions">
            <button className="btn btn-ghost sm" onClick={() => sheets.open({ kind: 'decline', claim: claim! })}>
              Not yet
            </button>
            <AsyncButton
              className="btn btn-caramel sm"
              onClick={() => act((b) => b.reviewClaim(claim!.id, true, ''), { success: `${claim!.points} brownies for ${p}!`, celebrate: true })}
            >
              <Check size={16} /> Approve
            </AsyncButton>
          </div>
        </div>
      ) : (
        <div className="tc-bottom">
          <div className="tc-tags">
            {task.shared && (
              <span className="tag">
                <Users size={12} /> Either of us
              </span>
            )}
            <RepeatTag repeatable={task.repeatable} />
            {!active && (
              <span className="tag">
                <Moon size={12} /> Resting
              </span>
            )}
          </div>
          <div className="tc-actions">
            {manage && active && task.decay_hours ? (
              <AsyncButton
                className="icon-btn sm warm"
                disabled={fresh >= 0.999}
                onClick={() => act((b) => b.bumpTask(task.id), { success: 'Warmed up: full price again' })}
                aria-label="Warm it up (full price again)"
                title="Warm it up"
              >
                <Flame size={15} />
              </AsyncButton>
            ) : null}
            {manage && (
              <AsyncButton
                className="icon-btn sm"
                onClick={() => act((b) => b.setTaskActive(task.id, !active), { success: active ? 'Resting until it’s needed' : 'Back on the menu' })}
                aria-label={active ? 'Pause this task' : 'Bring this task back'}
                title={active ? 'Pause' : 'Bring back'}
              >
                {active ? <Pause size={15} /> : <Play size={15} />}
              </AsyncButton>
            )}
            {(iSetIt || task.shared) && (
              <button className="icon-btn sm" onClick={() => sheets.open({ kind: 'task', task })} aria-label="Edit" title="Edit">
                <Pencil size={14} />
              </button>
            )}
            {iDoIt &&
              active &&
              (claimedByMe ? (
                <span className="tc-status">
                  <span className="pulse-dot" /> Waiting for {p}
                  <AsyncButton className="link" onClick={() => act((b) => b.withdrawClaim(claim!.id))}>
                    Undo
                  </AsyncButton>
                </span>
              ) : (
                <AsyncButton
                  className="btn btn-caramel sm"
                  onClick={() => act((b) => b.claimTask(task.id, ''), { success: `Sent to ${p} for approval` })}
                >
                  <Check size={16} /> I did it!
                </AsyncButton>
              ))}
          </div>
        </div>
      )}
    </article>
  );
}

/** A shared task waiting for you to agree (or one you're waiting on). */
export function ProposalCard({ task }: { task: Task }) {
  const { state, d } = useLoaded();
  const sheets = useSheets();
  const p = state.partner?.display_name ?? 'Your partner';
  const partnerId = d.partnerId ?? '';
  const forMe = task.awaiting === d.myId;
  const isNew = task.updated_at === task.created_at;
  return (
    <article className={`card action-card ${forMe ? 'needs-you' : 'is-waiting'}`}>
      <div className="ac-icon">
        <Handshake size={20} />
      </div>
      <div className="ac-main">
        <p className="kicker">
          {forMe ? (isNew ? `${p} proposed a shared task` : `${p} suggested changes`) : `Waiting for ${p} to agree`}
        </p>
        <h3>{task.title}</h3>
        <p className="meta">
          You’d earn <Amount n={basePrice(task, d.myId)} size="sm" /> · {p} <Amount n={basePrice(task, partnerId)} size="sm" />
        </p>
        {task.active === false && (
          <span className="tag resting-tag">
            <Moon size={12} /> Starts resting
          </span>
        )}
      </div>
      <div className="ac-actions">
        {forMe ? (
          <button className="btn btn-caramel sm" onClick={() => sheets.open({ kind: 'proposal', task })}>
            <Handshake size={16} /> Review deal
          </button>
        ) : (
          <button className="btn btn-ghost sm" onClick={() => sheets.open({ kind: 'task', task })}>
            <Pencil size={14} /> Change
          </button>
        )}
      </div>
    </article>
  );
}
