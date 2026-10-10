import { Plus } from 'lucide-react';
import { useLoaded } from '../app/store';
import { useSessionState } from '../app/useSessionState';
import { Amount } from '../components/Brownie';
import { SortableList } from '../components/SortableList';
import { Empty, Segmented } from '../components/ui';
import { inOrder, isActive } from '../lib/tasks';
import type { Task } from '../lib/types';
import { ProposalCard, TaskCard } from './cards';
import { useSheets } from './sheets';

type View = 'mine' | 'shared' | 'theirs';

export function Tasks() {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const p = state.partner!.display_name;
  const [view, setView] = useSessionState<View>('bp-tasks-view', 'mine');
  const order = state.me.task_order;

  const reviewIn = (tasks: Task[]) => tasks.filter((t) => d.pendingClaimByTask.get(t.id)?.claimed_by === d.partnerId).length;
  const sharedAlerts = d.proposalsForMe.length + reviewIn(d.sharedTasks);
  const theirAlerts = reviewIn(d.tasksForPartner);

  /** Save a list's new order, keeping the rest of your order as it was. */
  const reorder = (ids: string[]) => {
    const rest = (order ?? []).filter((id) => !ids.includes(id));
    act((b) => b.setTaskOrder([...ids, ...rest]));
  };

  const subtitle = {
    mine: `Set by ${p}. Do them, tap “I did it!”, and ${p} approves.`,
    shared: `Jobs either of you can do. You each agree on what you’d earn.`,
    theirs: `You set these for ${p}, and you decide what each is worth.`,
  }[view];

  return (
    <div className="stack">
      <header className="screen-head">
        <h1 className="screen-title">Tasks</h1>
        <p className="screen-sub">{subtitle}</p>
      </header>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'mine', label: <>For you <Count n={d.tasksForMe.filter(isActive).length} /></> },
          { value: 'shared', label: <>Shared <Count n={sharedAlerts || d.sharedTasks.filter(isActive).length} alert={sharedAlerts > 0} /></> },
          { value: 'theirs', label: <>For {p} <Count n={theirAlerts || d.tasksForPartner.filter(isActive).length} alert={theirAlerts > 0} /></> },
        ]}
      />

      {view === 'mine' && (
        <TaskList
          tasks={d.tasksForMe}
          done={d.doneForMe}
          order={order}
          onReorder={reorder}
          empty={
            <Empty title="Nothing on your plate">
              {p} hasn’t set you any tasks yet. Give them a nudge, or set some for them first.
            </Empty>
          }
        />
      )}

      {view === 'shared' && (
        <>
          {(d.proposalsForMe.length > 0 || d.proposalsWaiting.length > 0) && (
            <div className="stack-sm">
              {d.proposalsForMe.map((t) => (
                <ProposalCard key={t.id} task={t} />
              ))}
              {d.proposalsWaiting.map((t) => (
                <ProposalCard key={t.id} task={t} />
              ))}
            </div>
          )}
          <button className="btn btn-caramel block" onClick={() => sheets.open({ kind: 'task', shared: true })}>
            <Plus size={18} /> New shared task
          </button>
          <TaskList
            tasks={d.sharedTasks}
            done={d.doneShared}
            order={order}
            onReorder={reorder}
            empty={
              d.proposalsForMe.length + d.proposalsWaiting.length === 0 ? (
                <Empty title="Nothing shared yet">
                  Jobs that just need doing, like the toilet or the lawn. Whoever hates it more can ask for more brownies.
                </Empty>
              ) : null
            }
          />
        </>
      )}

      {view === 'theirs' && (
        <>
          <button className="btn btn-caramel block" onClick={() => sheets.open({ kind: 'task' })}>
            <Plus size={18} /> New task for {p}
          </button>
          <TaskList
            tasks={d.tasksForPartner}
            done={d.doneForPartner}
            order={order}
            onReorder={reorder}
            empty={<Empty title={`Give ${p} something to earn`}>Dishes, a foot rub, an epic playlist… anything you’d love them to do.</Empty>}
          />
        </>
      )}
    </div>
  );
}

function Count({ n, alert }: { n: number; alert?: boolean }) {
  return <span className={`seg-count ${alert ? 'alert' : ''}`}>{n}</span>;
}

/** Live tasks (drag to reorder), then resting ones, then finished one-offs. */
function TaskList({
  tasks,
  done,
  order,
  onReorder,
  empty,
}: {
  tasks: Task[];
  done: Task[];
  order: string[] | undefined;
  onReorder: (ids: string[]) => void;
  empty: React.ReactNode;
}) {
  const live = inOrder(tasks.filter(isActive), order);
  const resting = inOrder(
    tasks.filter((t) => !isActive(t)),
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
            <span className="summary-hint">paused until they’re needed</span>
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
