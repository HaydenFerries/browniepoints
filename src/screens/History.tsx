import type { ComponentType } from 'react';
import {
  ArrowLeftRight,
  BadgeCheck,
  ClipboardList,
  Gift,
  Flame,
  Hand,
  Handshake,
  Heart,
  HeartCrack,
  HeartHandshake,
  PackageCheck,
  Pause,
  PencilLine,
  Play,
  RotateCcw,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useLoaded } from '../app/store';
import { useSessionState } from '../app/useSessionState';
import { Amount } from '../components/Brownie';
import { Avatar, Empty, Segmented } from '../components/ui';
import { describe } from '../lib/describe';
import type { Activity, ActivityKind } from '../lib/types';
import { clockTime, dayLabel, timeAgo } from '../lib/util';

const ICONS: Record<ActivityKind, ComponentType<{ size?: number }>> = {
  paired: Heart,
  unpaired: HeartCrack,
  task_added: ClipboardList,
  task_updated: PencilLine,
  task_removed: Trash2,
  task_claimed: Hand,
  claim_withdrawn: Undo2,
  task_approved: BadgeCheck,
  task_declined: RotateCcw,
  reward_added: Sparkles,
  reward_updated: PencilLine,
  reward_removed: Trash2,
  reward_priced: Tag,
  reward_redeemed: Gift,
  redemption_cancelled: Undo2,
  redemption_delivered: PackageCheck,
  gift: HeartHandshake,
  shared_proposed: Handshake,
  shared_changed: ArrowLeftRight,
  shared_agreed: Handshake,
  shared_declined: X,
  task_paused: Pause,
  task_resumed: Play,
  task_bumped: Flame,
};

export function FeedItem({ a, showTime = 'ago' }: { a: Activity; showTime?: 'ago' | 'clock' }) {
  const { state, d } = useLoaded();
  const Icon = ICONS[a.kind] ?? Sparkles;
  const p = state.partner?.display_name ?? 'Your partner';
  const forMe = a.beneficiary_id === d.myId;
  const showWorth = a.delta == null && a.value != null && (a.kind === 'task_added' || a.kind === 'reward_priced');
  return (
    <li className={`feed-item k-${a.kind}`}>
      <span className={`feed-icon ${a.actor_id === d.myId ? 'by-me' : 'by-partner'}`}>
        <Icon size={16} />
      </span>
      <div className="feed-main">
        <p className="feed-text">{describe(a, d.myId, p)}</p>
        {a.note && <p className="feed-note">“{a.note}”</p>}
        <time dateTime={a.created_at}>{showTime === 'ago' ? timeAgo(a.created_at) : clockTime(a.created_at)}</time>
      </div>
      {a.delta != null && (
        <span className={`feed-delta ${forMe ? 'for-me' : 'for-partner'}`} title={forMe ? 'Your balance' : `${p}’s balance`}>
          <Amount n={a.delta} sign size="sm" />
          <small>{forMe ? 'you' : p}</small>
        </span>
      )}
      {showWorth && (
        <span className="feed-worth">
          <Amount n={a.value!} size="sm" />
        </span>
      )}
    </li>
  );
}

export function Feed({ items }: { items: Activity[] }) {
  if (!items.length) return <p className="muted small center">Nothing yet. Your story starts here.</p>;
  return (
    <ul className="feed card">
      {items.map((a) => (
        <FeedItem key={a.id} a={a} />
      ))}
    </ul>
  );
}

export function History() {
  const { state, d } = useLoaded();
  const partner = state.partner!;
  const [filter, setFilter] = useSessionState<'all' | 'brownies'>('bp-history-filter', 'all');
  const items = state.activity.filter((a) => filter === 'all' || a.delta != null);
  const groups: { day: string; items: Activity[] }[] = [];
  for (const a of items) {
    const day = dayLabel(a.created_at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(a);
    else groups.push({ day, items: [a] });
  }
  const tasksDone = (id: string) => state.activity.filter((a) => a.kind === 'task_approved' && a.beneficiary_id === id).length;
  const treats = (id: string) => state.redemptions.filter((r) => r.redeemed_by === id && r.status === 'delivered').length;

  return (
    <div className="stack">
      <header className="screen-head">
        <h1 className="screen-title">History</h1>
        <p className="screen-sub">Every brownie, baked and eaten.</p>
      </header>

      <section className="card scoreboard">
        {[
          { name: 'You', emoji: state.me.avatar, tone: 'caramel' as const, bal: d.myBalance, earned: d.myEarned, done: tasksDone(d.myId), treats: treats(d.myId) },
          { name: partner.display_name, emoji: partner.avatar, tone: 'berry' as const, bal: d.partnerBalance, earned: d.partnerEarned, done: tasksDone(partner.id), treats: treats(partner.id) },
        ].map((s) => (
          <div key={s.name} className={`score score-${s.tone}`}>
            <div className="score-head">
              <Avatar emoji={s.emoji} tone={s.tone} size={30} />
              <span>{s.name}</span>
            </div>
            <Amount n={s.bal} size="lg" />
            <dl>
              <div>
                <dt>Earned</dt>
                <dd>{s.earned}</dd>
              </div>
              <div>
                <dt>Tasks</dt>
                <dd>{s.done}</dd>
              </div>
              <div>
                <dt>Treats</dt>
                <dd>{s.treats}</dd>
              </div>
            </dl>
          </div>
        ))}
      </section>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'Everything' },
          { value: 'brownies', label: 'Brownie moves' },
        ]}
      />

      {groups.length === 0 && <Empty title="Nothing here yet" />}
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="day-label">{g.day}</h2>
          <ul className="feed card">
            {g.items.map((a) => (
              <FeedItem key={a.id} a={a} showTime="clock" />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
