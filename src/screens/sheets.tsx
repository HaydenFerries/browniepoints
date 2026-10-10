import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Flame, Handshake, Lock, Moon, Play, Repeat, Trash2, Users } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Amount } from '../components/Brownie';
import { PointsPicker, Sheet } from '../components/ui';
import { DecayGraph } from '../components/DecayGraph';
import type { Claim, Reward, Task, TaskInput } from '../lib/types';
import type { Backend } from '../lib/backend';
import { basePrice, canManage, durationLabel, isActive, rawStale, staleValue } from '../lib/tasks';

/** A stale price only if it's still below the (possibly new) full price. */
const fits = (stale: number | null, price: number) => (stale != null && stale < price ? stale : null);

export type SheetState =
  | { kind: 'task'; task?: Task; shared?: boolean }
  | { kind: 'proposal'; task: Task }
  | { kind: 'wish'; reward?: Reward }
  | { kind: 'price'; reward: Reward }
  | { kind: 'gift' }
  | { kind: 'decline'; claim: Claim }
  | { kind: 'profile' }
  | {
      kind: 'confirm';
      title: string;
      body: ReactNode;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => Promise<unknown> | void;
    };

const SheetCtx = createContext<{ open(s: SheetState): void; close(): void } | null>(null);

export function useSheets() {
  const c = useContext(SheetCtx);
  if (!c) throw new Error('useSheets outside SheetHost');
  return c;
}

export function SheetHost({ children, renderProfile }: { children: ReactNode; renderProfile: (close: () => void) => ReactNode }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const close = useCallback(() => setSheet(null), []);
  const api = { open: setSheet, close };
  return (
    <SheetCtx.Provider value={api}>
      {children}
      {sheet?.kind === 'task' && <TaskSheet task={sheet.task} shared={sheet.shared} onClose={close} />}
      {sheet?.kind === 'proposal' && <ProposalSheet task={sheet.task} onClose={close} />}
      {sheet?.kind === 'wish' && <WishSheet reward={sheet.reward} onClose={close} />}
      {sheet?.kind === 'price' && <PriceSheet reward={sheet.reward} onClose={close} />}
      {sheet?.kind === 'gift' && <GiftSheet onClose={close} />}
      {sheet?.kind === 'decline' && <DeclineSheet claim={sheet.claim} onClose={close} />}
      {sheet?.kind === 'confirm' && <ConfirmSheet {...sheet} onClose={close} />}
      {sheet?.kind === 'profile' && renderProfile(close)}
    </SheetCtx.Provider>
  );
}

const TASK_IDEAS = [
  'Do the dishes',
  'Make breakfast',
  'Plan a date night',
  'Take the bins out',
  'Fold the laundry',
  'Give a foot rub',
  'Walk the dog',
  'Cook dinner',
];
const SHARED_IDEAS = ['Clean the toilet', 'Mow the lawn', 'Vacuum the house', 'Change the sheets', 'Do the grocery run', 'Wash the car'];

function TaskSheet({ task, shared: startShared, onClose }: { task?: Task; shared?: boolean; onClose: () => void }) {
  const { state, d, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const partnerId = d.partnerId ?? '';
  const [shared, setShared] = useState(task ? !!task.shared : !!startShared);
  const [title, setTitle] = useState(task?.title ?? '');
  const [details, setDetails] = useState(task?.details ?? '');
  const [partnerPoints, setPartnerPoints] = useState(task ? basePrice(task, partnerId) : 10);
  const [myPoints, setMyPoints] = useState(task?.shared ? basePrice(task, d.myId) : 10);
  const [repeatable, setRepeatable] = useState(task?.repeatable ?? true);
  const [timed, setTimed] = useState(!!task?.decay_hours);
  const [decayHours, setDecayHours] = useState(task?.decay_hours ?? 72);
  const [grace, setGrace] = useState(task?.decay_grace_hours ?? 0);
  // Stale prices in brownies; null = not chosen yet, so it follows the price (a quarter of it).
  const [stalePartnerSet, setStalePartner] = useState<number | null>(
    task?.decay_hours ? Math.round(staleValue(task, partnerId)) : null,
  );
  const [staleMineSet, setStaleMine] = useState<number | null>(
    task?.shared && task.decay_hours ? Math.round(staleValue(task, d.myId)) : null,
  );
  // Shared tasks: one price for both of you, or "we're different"
  const [samePrice, setSamePrice] = useState(
    !task?.shared ||
      (basePrice(task, d.myId) === basePrice(task, partnerId) &&
        (!task.decay_hours || Math.round(staleValue(task, d.myId)) === Math.round(staleValue(task, partnerId)))),
  );
  const [startActive, setStartActive] = useState(task ? isActive(task) : true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canRemove = !task || canManage(task, d.myId);
  const canSwitchType = !task || (!!task.shared && !!task.awaiting && task.created_by === d.myId);

  const split = shared && !samePrice;
  const autoStale = (price: number) => Math.max(1, Math.round(price / 4));
  const theirPrice = partnerPoints;
  const myPrice = split ? myPoints : partnerPoints;
  const theirStale = stalePartnerSet ?? autoStale(theirPrice);
  const myStale = split ? (staleMineSet ?? autoStale(myPrice)) : theirStale;
  const priceBad = theirPrice < 1 || (shared && myPrice < 1);
  const staleBad = timed && (theirStale < 1 || theirStale >= theirPrice || (shared && (myStale < 1 || myStale >= myPrice)));

  async function save() {
    setBusy(true);
    const input: TaskInput = {
      title,
      details,
      shared,
      partnerPoints: theirPrice,
      myPoints: shared ? myPrice : null,
      repeatable,
      decayHours: timed ? decayHours : null,
      decayFloor: 25,
      decayGrace: grace,
      stalePartner: timed ? theirStale : null,
      staleMine: timed && shared ? myStale : null,
      startActive,
    };
    const success = shared
      ? `Sent to ${partner} to agree`
      : task
        ? 'Task updated'
        : startActive
          ? `Task sent to ${partner}`
          : 'Saved to Resting. Switch it on when it’s needed';
    const ok = await act(
      async (b) => {
        if (!task) return b.createTask(input);
        if (shared !== !!task.shared) {
          // switching a proposal between shared and regular: replace it
          await b.removeTask(task.id);
          return b.createTask(input);
        }
        return b.editTask(task.id, input);
      },
      { success },
    );
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!task) return;
    setBusy(true);
    const ok = await act((b) => b.removeTask(task.id), { success: 'Task removed' });
    setBusy(false);
    if (ok) onClose();
  }

  const heading = task ? (shared ? 'Edit shared task' : 'Edit task') : shared ? 'New shared task' : `New task for ${partner}`;
  const subtitle = task
    ? shared
      ? `Any change goes back to ${partner} to agree.`
      : undefined
    : shared
      ? `Either of you can do it. ${partner} has to agree before it goes live.`
      : `You decide what it’s worth. ${partner} earns the brownies once you approve it.`;

  return (
    <Sheet
      open
      onClose={onClose}
      title={heading}
      subtitle={subtitle}
      footer={
        <>
          {task &&
            canRemove &&
            (confirmDelete ? (
              <button className="btn btn-danger" onClick={remove} disabled={busy}>
                Really remove?
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)} aria-label="Remove task">
                <Trash2 size={18} />
              </button>
            ))}
          <button className="btn btn-caramel grow" onClick={save} disabled={busy || !title.trim() || priceBad || staleBad}>
            {shared ? (task ? 'Send changes to agree' : 'Propose to ' + partner) : task ? 'Save changes' : 'Send task'}
          </button>
        </>
      }
    >
      {canSwitchType && (
        <div className="field">
          <span className="field-label">Who does it?</span>
          <div className="toggle-pair">
            <button type="button" className={!shared ? 'on' : ''} onClick={() => setShared(false)}>
              {partner}
            </button>
            <button type="button" className={shared ? 'on' : ''} onClick={() => setShared(true)}>
              <Users size={16} /> Either of us
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span className="field-label">What needs doing?</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Do the dishes" maxLength={80} />
      </label>
      {!task && !title && (
        <div className="chips">
          {(shared ? SHARED_IDEAS : TASK_IDEAS).map((idea) => (
            <button key={idea} type="button" className="chip" onClick={() => setTitle(idea)}>
              {idea}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span className="field-label">
          Any details? <em>optional</em>
        </span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={500} placeholder="Little hints, deadlines, standards…" />
      </label>

      {shared && (
        <div className="field">
          <span className="field-label">Price</span>
          <div className="toggle-pair">
            <button type="button" className={samePrice ? 'on' : ''} onClick={() => setSamePrice(true)}>
              Same for both of us
            </button>
            <button
              type="button"
              className={!samePrice ? 'on' : ''}
              onClick={() => {
                if (samePrice) {
                  // start from the shared price, then tweak
                  setMyPoints(partnerPoints);
                  setStaleMine(stalePartnerSet);
                }
                setSamePrice(false);
              }}
            >
              We’re different
            </button>
          </div>
        </div>
      )}

      {split ? (
        <div className="price-pair">
          <div className="field">
            <span className="field-label">If you do it, you earn</span>
            <PointsPicker value={myPoints} onChange={setMyPoints} />
          </div>
          <div className="field">
            <span className="field-label">If {partner} does it</span>
            <PointsPicker value={partnerPoints} onChange={setPartnerPoints} />
          </div>
          <p className="muted small">Hate the job? Ask for more. You each get your own price.</p>
        </div>
      ) : (
        <div className="field">
          <span className="field-label">{shared ? 'Whoever does it earns' : 'Worth'}</span>
          <PointsPicker value={partnerPoints} onChange={setPartnerPoints} />
        </div>
      )}

      <div className="field">
        <span className="field-label">How often?</span>
        <div className="toggle-pair">
          <button type="button" className={repeatable ? 'on' : ''} onClick={() => setRepeatable(true)}>
            <Repeat size={16} /> Again &amp; again
          </button>
          <button type="button" className={!repeatable ? 'on' : ''} onClick={() => setRepeatable(false)}>
            Just once
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Price over time</span>
        <div className="toggle-pair">
          <button type="button" className={!timed ? 'on' : ''} onClick={() => setTimed(false)}>
            Always the same
          </button>
          <button type="button" className={timed ? 'on' : ''} onClick={() => setTimed(true)}>
            <Flame size={16} /> Best when fresh
          </button>
        </div>
        {timed && (
          <div className="timed-options">
            <div className={`stale-prices ${split ? 'two' : ''}`}>
              <div className="field">
                <span className="field-label">{split ? 'Your stale price' : 'Stale price'}</span>
                <PointsPicker
                  compact
                  presets={[]}
                  value={split ? myStale : theirStale}
                  onChange={split ? setStaleMine : setStalePartner}
                />
              </div>
              {split && (
                <div className="field">
                  <span className="field-label">{partner}’s stale price</span>
                  <PointsPicker compact presets={[]} value={theirStale} onChange={setStalePartner} />
                </div>
              )}
            </div>
            {staleBad && <p className="pp-error">The stale price has to be lower than the full price.</p>}
            <DecayGraph
              price={shared ? myPrice : theirPrice}
              stalePrice={shared ? myStale : theirStale}
              value={{ grace, stale: decayHours }}
              onChange={(v) => {
                setGrace(v.grace);
                setDecayHours(v.stale);
              }}
            />
            {split && <p className="small muted">The graph shows your prices; {partner}’s slides on the same timing.</p>}
          </div>
        )}
      </div>

      <div className="field">
          <span className="field-label">{task ? 'Status' : 'Start it'}</span>
          <div className="toggle-pair">
            <button type="button" className={startActive ? 'on' : ''} onClick={() => setStartActive(true)}>
              <Play size={16} /> {task ? 'Live' : 'Now'}
            </button>
            <button type="button" className={!startActive ? 'on' : ''} onClick={() => setStartActive(false)}>
              <Moon size={16} /> Resting
            </button>
          </div>
          {!startActive && (
            <p className="small muted">
              {task ? 'It waits in the Resting section until it’s switched on.' : 'Pre-make it now and switch it on from the Resting section when it’s needed.'}
              {shared ? ` ${partner} still agrees to it first.` : ''}
            </p>
          )}
        </div>
    </Sheet>
  );
}

/** Agree to a shared task, counter with different prices, or turn it down. */
function ProposalSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const { state, d, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const partnerId = d.partnerId ?? '';
  const proposedMine = basePrice(task, d.myId);
  const proposedTheirs = basePrice(task, partnerId);
  const [myPoints, setMyPoints] = useState(proposedMine);
  const [partnerPoints, setPartnerPoints] = useState(proposedTheirs);
  const [busy, setBusy] = useState(false);
  const changed = myPoints !== proposedMine || partnerPoints !== proposedTheirs;

  const run = async (fn: (b: Backend) => Promise<unknown>, success: string, celebrate = false) => {
    setBusy(true);
    const ok = await act(fn, { success, celebrate });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={task.title}
      subtitle={`${partner} wants to share this one. Either of you can do it and earn your own price.`}
      footer={
        <>
          <button className="btn btn-ghost danger-text" disabled={busy} onClick={() => run((b) => b.respondShared(task.id, false), 'Turned down')}>
            Decline
          </button>
          {changed ? (
            <button
              className="btn btn-caramel grow"
              disabled={busy || myPoints < 1 || partnerPoints < 1}
              onClick={() =>
                run(
                  (b) =>
                    b.editTask(task.id, {
                      title: task.title,
                      details: task.details,
                      shared: true,
                      partnerPoints,
                      myPoints,
                      repeatable: task.repeatable,
                      decayHours: task.decay_hours ?? null,
                      decayFloor: task.decay_floor_pct ?? 25,
                      decayGrace: task.decay_grace_hours ?? 0,
                      stalePartner: fits(rawStale(task, partnerId), partnerPoints),
                      staleMine: fits(rawStale(task, d.myId), myPoints),
                    }),
                  `Counter-offer sent to ${partner}`,
                )
              }
            >
              <ArrowLeftRight size={16} /> Send counter-offer
            </button>
          ) : (
            <button className="btn btn-caramel grow" disabled={busy} onClick={() => run((b) => b.respondShared(task.id, true), task.active === false ? 'Deal! It’s waiting in Resting.' : 'Deal! It’s live.', true)}>
              <Handshake size={16} /> Agree
            </button>
          )}
        </>
      }
    >
      {task.details && <p className="quote">“{task.details}”</p>}
      <p className="small muted">
        {task.repeatable ? 'Again & again' : 'Just once'}
        {task.decay_hours ? ` · best when fresh, goes stale over ${durationLabel(task.decay_hours)}` : ''}
      </p>
      {task.active === false && (
        <p className="lock-note resting-note">
          <Moon size={16} />
          <span>
            <strong>Starts resting.</strong> Once you agree, it waits in the Resting section until one of you switches it on.
          </span>
        </p>
      )}
      <div className="price-pair">
        <div className="field">
          <span className="field-label">If you do it, you earn</span>
          <PointsPicker value={myPoints} onChange={setMyPoints} />
        </div>
        <div className="field">
          <span className="field-label">If {partner} does it</span>
          <PointsPicker value={partnerPoints} onChange={setPartnerPoints} />
        </div>
      </div>
      <p className="muted small">
        {changed ? `Changing a price sends it back to ${partner} to agree.` : task.active === false
            ? 'Happy with these prices? Agree and it waits in Resting for both of you.'
            : 'Happy with these prices? Agree and it goes live for both of you.'}
      </p>
    </Sheet>
  );
}

const WISH_IDEAS: [string, string][] = [
  ['💆', 'Back massage'],
  ['🥞', 'Breakfast in bed'],
  ['🎬', 'I pick the movie'],
  ['😴', 'A sleep-in'],
  ['🍝', 'Dinner date'],
  ['🛋️', 'A no-chores day'],
  ['🍫', 'Homemade brownies'],
  ['💐', 'Surprise flowers'],
];
const EMOJIS = ['🎁', '💆', '🥞', '🎬', '😴', '🍝', '🛋️', '🍫', '💐', '☕', '🍷', '🛁', '🎮', '✈️', '🧁', '💋'];

function WishSheet({ reward, onClose }: { reward?: Reward; onClose: () => void }) {
  const { state, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const [title, setTitle] = useState(reward?.title ?? '');
  const [details, setDetails] = useState(reward?.details ?? '');
  const [emoji, setEmoji] = useState(reward?.emoji ?? '🎁');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = !!reward && reward.price != null;

  async function save() {
    setBusy(true);
    const input = { title, details, emoji };
    const ok = await act((b) => (reward ? b.updateReward(reward.id, input) : b.addReward(input)), {
      success: reward ? 'Wish updated' : `Added! ${partner} will set the price.`,
    });
    setBusy(false);
    if (ok) onClose();
  }
  async function remove() {
    if (!reward) return;
    setBusy(true);
    const ok = await act((b) => b.removeReward(reward.id), { success: 'Wish removed' });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={reward ? 'Edit wish' : 'Add a wish'}
      subtitle={reward ? undefined : `Something you’d love from ${partner}. They decide how many brownies it costs.`}
      footer={
        <>
          {reward &&
            (confirmDelete ? (
              <button className="btn btn-danger" onClick={remove} disabled={busy}>
                Really remove?
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)} aria-label="Remove wish">
                <Trash2 size={18} />
              </button>
            ))}
          {locked ? (
            <button className="btn btn-ghost grow" onClick={onClose}>
              Close
            </button>
          ) : (
            <button className="btn btn-caramel grow" onClick={save} disabled={busy || !title.trim()}>
              {reward ? 'Save changes' : 'Add to my wishlist'}
            </button>
          )}
        </>
      }
    >
      {locked && (
        <p className="lock-note">
          <Lock size={16} /> {partner} has priced this at {reward!.price}, so it’s locked. To change it, remove it and add a new wish.
        </p>
      )}
      <fieldset className="plain" disabled={locked}>
      <div className="emoji-row" role="radiogroup" aria-label="Icon">
        {EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={e === emoji} className={e === emoji ? 'on' : ''} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">What would make you melt?</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Breakfast in bed" maxLength={80} />
      </label>
      {!reward && !title && (
        <div className="chips">
          {WISH_IDEAS.map(([e, idea]) => (
            <button
              key={idea}
              type="button"
              className="chip"
              onClick={() => {
                setTitle(idea);
                setEmoji(e);
              }}
            >
              {e} {idea}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span className="field-label">
          Details <em>optional</em>
        </span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={500} placeholder="Make it extra specific…" />
      </label>
      </fieldset>
    </Sheet>
  );
}

function PriceSheet({ reward, onClose }: { reward: Reward; onClose: () => void }) {
  const { state, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const [price, setPrice] = useState(reward.price ?? 25);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const ok = await act((b) => b.priceReward(reward.id, price), { success: `Priced at ${price}` });
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <>
          <span className="sheet-emoji">{reward.emoji}</span> {reward.title}
        </>
      }
      subtitle={`How many brownies should ${partner} spend on this? You’re the one giving it, so you set the price.`}
      footer={
        <button className="btn btn-caramel grow" onClick={save} disabled={busy || price < 1}>
          {reward.price == null ? 'Set price' : 'Update price'}
        </button>
      }
    >
      {reward.details && <p className="quote">“{reward.details}”</p>}
      <PointsPicker value={price} onChange={setPrice} presets={[10, 25, 50, 100]} max={10000} />
    </Sheet>
  );
}

function GiftSheet({ onClose }: { onClose: () => void }) {
  const { state, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const [amount, setAmount] = useState(5);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const ok = await act((b) => b.giftBrownies(amount, note), { success: `Sent ${partner} ${amount} brownies`, celebrate: true });
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Treat ${partner}`}
      subtitle="A spontaneous little thank-you, no task needed."
      footer={
        <button className="btn btn-caramel grow" onClick={send} disabled={busy || amount < 1}>
          Gift <Amount n={amount} size="sm" />
        </button>
      }
    >
      <PointsPicker value={amount} onChange={setAmount} presets={[1, 5, 10, 25]} max={500} />
      <label className="field">
        <span className="field-label">
          Say why <em>optional</em>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="For being wonderful" maxLength={300} />
      </label>
    </Sheet>
  );
}

function DeclineSheet({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { state, d, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const task = d.taskById.get(claim.task_id);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    const ok = await act((b) => b.reviewClaim(claim.id, false, note), { success: 'Sent back to the oven' });
    setBusy(false);
    if (ok) onClose();
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="Not quite done?"
      subtitle={`“${task?.title ?? 'This task'}” goes back on ${partner}’s list. No brownies change hands.`}
      footer={
        <button className="btn btn-berry grow" onClick={send} disabled={busy}>
          Send it back
        </button>
      }
    >
      <label className="field">
        <span className="field-label">
          What’s missing? <em>optional</em>
        </span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="The pots are still in the sink 👀" maxLength={300} />
      </label>
    </Sheet>
  );
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: Extract<SheetState, { kind: 'confirm' }> & { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Never mind
          </button>
          <button
            className={`btn grow ${danger ? 'btn-berry' : 'btn-caramel'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">{body}</div>
    </Sheet>
  );
}
