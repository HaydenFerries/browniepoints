import { Plus } from 'lucide-react';
import { useLoaded } from '../app/store';
import { useNow } from '../app/useNow';
import { useSessionState } from '../app/useSessionState';
import { Amount } from '../components/Brownie';
import { SortableList } from '../components/SortableList';
import { Empty, Segmented } from '../components/ui';
import { inOrder, isLive } from '../lib/tasks';
import type { Task } from '../lib/types';
import { ProposalCard, TaskCard } from './cards';
import { useSheets } from './sheets';

type View = 'mine' | 'theirs';

export function Tasks() {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const now = useNow();
  const p = state.partner!.display_name;
  const [stored, setView] = useSessionState<View | 'shared'>('bp-tasks-view', 'mine');
  const view: View = stored === 'theirs' ? 'theirs' : 'mine'; // (there used to be a Shared tab)
  const order = state.me.task_order;

  const myAlerts = d.proposalsForMe.length;
  const theirAlerts = d.claimsToReview.length;

  /** Save a list's new order, keeping the rest of your order as it was. */
  const reorder = (ids: string[]) => {
    const rest = (order ?? []).filter((id) => !ids.includes(id));
    act((b) => b.setTaskOrder([...ids, ...rest]));
  };

  const liveCount = (tasks: Task[]) => tasks.filter((t) => isLive(t, now)).length;

  return (
    <div className="stack">
      <header className="screen-head">
        <h1 className="screen-title">Tasks</h1>
        <p className="screen-sub">
          {view === 'mine'
            ? `Things you can do, set by ${p} or shared between you. Tap “I did it!” and ${p} approves.`
            : `Things ${p} can do. You decide what your tasks are worth; shared ones you agree on together.`}
        </p>
      </header>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'mine', label: <>For you <Count n={myAlerts || liveCount(d.tasksForMe)} alert={myAlerts > 0} /></> },
          { value: 'theirs', label: <>For {p} <Count n={theirAlerts || liveCount(d.tasksForPartner)} alert={theirAlerts > 0} /></> },
        ]}
      />

      {view === 'mine' ? (
        <>
          {d.proposalsForMe.length > 0 && (
            <div className="stack-sm">
              {d.proposalsForMe.map((t) => (
                <ProposalCard key={t.id} task={t} />
              ))}
            </div>
          )}
          <TaskList
            tasks={d.tasksForMe}
            done={d.doneForMe}
            order={order}
            now={now}
            onReorder={reorder}
            empty={
              d.proposalsForMe.length === 0 ? (
                <Empty title="Nothing on your plate">
                  {p} hasn’t set you any tasks yet. Give them a nudge, or set some for them first.
                </Empty>
              ) : null
            }
          />
        </>
      ) : (
        <>
          <button className="btn btn-caramel block" onClick={() => sheets.open({ kind: 'task' })}>
            <Plus size={18} /> New task
          </button>
          {d.proposalsWaiting.length > 0 && (
            <div className="stack-sm">
              {d.proposalsWaiting.map((t) => (
                <ProposalCard key={t.id} task={t} />
              ))}
            </div>
          )}
          <TaskList
            tasks={d.tasksForPartner}
            done={d.doneForPartner}
            order={order}
            now={now}
            onReorder={reorder}
            empty={
              d.proposalsWaiting.length === 0 ? (
                <Empty title={`Give ${p} something to earn`}>
                  Dishes, a foot rub, an epic playlist… or a shared job either of you can do.
                </Empty>
              ) : null
            }
          />
        </>
      )}
    </div>
  );
}

function Count({ n, alert }: { n: number; alert?: boolean }) {
  return <span className={`seg-count ${alert ? 'alert' : ''}`}>{n}</span>;
}

/** Live tasks (drag to reorder), then resting/sleeping ones, then finished one-offs. */
function TaskList({
  tasks,
  done,
  order,
  now,
  onReorder,
  empty,
}: {
  tasks: Task[];
  done: Task[];
  order: string[] | undefined;
  now: number;
  onReorder: (ids: string[]) => void;
  empty: React.ReactNode;
}) {
  const live = inOrder(
    tasks.filter((t) => isLive(t, now)),
    order,
  );
  const resting = inOrder(
    tasks.filter((t) => !isLive(t, now)),
    order,
  );
  return (
    <div className="stack-sm">
      {live.length > 0 && <SortableList items={live} onReorder={onReorder} render={(t, handle) => <TaskCard task={t} handle={handle} />} />}
      {live.length === 0 && resting.length === 0 && empty}
      {resting.length > 0 && (
        <details className="done-list resting-list">
          <summary>
            Resting <span className="seg-count">{resting.length}</span>
            <span className="summary-hint">paused or sleeping</span>
          </summary>
          <div className="stack-sm resting-cards">
            {resting.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </details>
      )}
      <DoneList tasks={done} />
    </div>
  );
}

function DoneList({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return null;
  return (
    <details className="done-list">
      <summary>
        Done &amp; dusted <span className="seg-count">{tasks.length}</span>
      </summary>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            <span className="done-title">{t.title}</span>
            <Amount n={t.points} size="sm" />
          </li>
        ))}
      </ul>
    </details>
  );
}
