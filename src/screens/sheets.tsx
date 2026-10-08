import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Repeat, Trash2 } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Amount } from '../components/Brownie';
import { PointsPicker, Sheet } from '../components/ui';
import type { Claim, Reward, Task } from '../lib/types';

export type SheetState =
  | { kind: 'task'; task?: Task }
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
      {sheet?.kind === 'task' && <TaskSheet task={sheet.task} onClose={close} />}
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

function TaskSheet({ task, onClose }: { task?: Task; onClose: () => void }) {
  const { state, act } = useLoaded();
  const partner = state.partner?.display_name ?? 'your partner';
  const [title, setTitle] = useState(task?.title ?? '');
  const [details, setDetails] = useState(task?.details ?? '');
  const [points, setPoints] = useState(task?.points ?? 10);
  const [repeatable, setRepeatable] = useState(task?.repeatable ?? true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    setBusy(true);
    const input = { title, details, points, repeatable };
    const ok = await act((b) => (task ? b.updateTask(task.id, input) : b.addTask(input)), {
      success: task ? 'Task updated' : `Task sent to ${partner}`,
    });
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

  return (
    <Sheet
      open
      onClose={onClose}
      title={task ? 'Edit task' : `New task for ${partner}`}
      subtitle={task ? undefined : `You decide what it’s worth. ${partner} earns the brownies once you approve it.`}
      footer={
        <>
          {task &&
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
            {task ? 'Save changes' : 'Send task'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">What needs doing?</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Do the dishes" maxLength={80} />
      </label>
      {!task && !title && (
        <div className="chips">
          {TASK_IDEAS.map((idea) => (
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
      <div className="field">
        <span className="field-label">Worth</span>
        <PointsPicker value={points} onChange={setPoints} />
      </div>
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
          <button className="btn btn-caramel grow" onClick={save} disabled={busy || !title.trim()}>
            {reward ? 'Save changes' : 'Add to my wishlist'}
          </button>
        </>
      }
    >
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
