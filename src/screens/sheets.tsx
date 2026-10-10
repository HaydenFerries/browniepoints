import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Flame, Handshake, Lock, Repeat, Trash2, Users } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Amount } from '../components/Brownie';
import { PointsPicker, Sheet } from '../components/ui';
import type { Claim, Reward, Task, TaskInput } from '../lib/types';
import type { Backend } from '../lib/backend';
import { basePrice, canManage, durationLabel } from '../lib/tasks';

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
const STALE_SPEEDS = [24, 72, 168, 336];
const FLOORS = [10, 25, 50];

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
  const [floor, setFloor] = useState(task?.decay_floor_pct ?? 25);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canRemove = !task || canManage(task, d.myId);

  async function save() {
    setBusy(true);
    const input: TaskInput = {
      title,
      details,
      shared,
      partnerPoints,
      myPoints: shared ? myPoints : null,
      repeatable,
      decayHours: timed ? decayHours : null,
      decayFloor: floor,
    };
    const success = shared
      ? `Sent to ${partner} to agree`
      : task
        ? 'Task updated'
        : `Task sent to ${partner}`;
    const ok = await act((b) => (task ? b.editTask(task.id, input) : b.createTask(input)), { success });
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
      ? `Either of you can do it, and you each earn your own price. ${partner} has to agree before it goes live.`
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
          <button className="btn btn-caramel grow" onClick={save} disabled={busy || !title.trim()}>
            {shared ? (task ? 'Send changes to agree' : 'Propose to ' + partner) : task ? 'Save changes' : 'Send task'}
          </button>
        </>
      }
    >
      {!task && (
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

      {shared ? (
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
          <span className="field-label">Worth</span>
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
            <span className="small muted">Goes stale over</span>
            <div className="chips">
              {STALE_SPEEDS.map((h) => (
                <button key={h} type="button" className={`chip ${decayHours === h ? 'chip-on' : ''}`} onClick={() => setDecayHours(h)}>
                  {durationLabel(h)}
                </button>
              ))}
            </div>
            <span className="small muted">Never drops below</span>
            <div className="chips">
              {FLOORS.map((f) => (
                <button key={f} type="button" className={`chip ${floor === f ? 'chip-on' : ''}`} onClick={() => setFloor(f)}>
                  {f}%
                </button>
              ))}
            </div>
            <p className="small muted">
              Worth {shared ? `${myPoints} / ${partnerPoints}` : partnerPoints} when fresh, sliding to{' '}
              {shared
                ? `${Math.max(1, Math.round((myPoints * floor) / 100))} / ${Math.max(1, Math.round((partnerPoints * floor) / 100))}`
                : Math.max(1, Math.round((partnerPoints * floor) / 100))}{' '}
              after {durationLabel(decayHours)}. Warm it up any time to make it fresh again.
            </p>
          </div>
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
              disabled={busy}
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
                    }),
                  `Counter-offer sent to ${partner}`,
                )
              }
            >
              <ArrowLeftRight size={16} /> Send counter-offer
            </button>
          ) : (
            <button className="btn btn-caramel grow" disabled={busy} onClick={() => run((b) => b.respondShared(task.id, true), 'Deal! It’s live.', true)}>
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
        {changed ? `Changing a price sends it back to ${partner} to agree.` : 'Happy with these prices? Agree and it goes live for both of you.'}
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
        <button className="btn btn-caramel grow" onClick={save} disabled={busy}>
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
        <button className="btn btn-caramel grow" onClick={send} disabled={busy}>
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
