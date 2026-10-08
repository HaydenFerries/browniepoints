import { Plus } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Empty, Segmented } from '../components/ui';
import { Amount } from '../components/Brownie';
import { MyTaskCard, TheirTaskCard } from './cards';
import { useSheets } from './sheets';
import { useSessionState } from '../app/useSessionState';

export function Tasks() {
  const { state, d } = useLoaded();
  const sheets = useSheets();
  const p = state.partner!.display_name;
  const [view, setView] = useSessionState<'mine' | 'theirs'>('bp-tasks-view', 'mine');
  const toReview = d.claimsToReview.length;

  return (
    <div className="stack">
      <header className="screen-head">
        <h1 className="screen-title">Tasks</h1>
        <p className="screen-sub">
          {view === 'mine' ? `Set by ${p}. Do them, tap “I did it!”, and ${p} approves.` : `You set these for ${p}, and you decide what each is worth.`}
        </p>
      </header>

      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'mine', label: <>For you <span className="seg-count">{d.tasksForMe.length}</span></> },
          {
            value: 'theirs',
            label: (
              <>
                For {p} {toReview > 0 ? <span className="seg-count alert">{toReview}</span> : <span className="seg-count">{d.tasksForPartner.length}</span>}
              </>
            ),
          },
        ]}
      />

      {view === 'mine' ? (
        <div className="stack-sm">
          {d.tasksForMe.map((t) => (
            <MyTaskCard key={t.id} task={t} />
          ))}
          {d.tasksForMe.length === 0 && (
            <Empty title="Nothing on your plate">
              {p} hasn’t set you any tasks yet. Give them a nudge, or set some for them first.
            </Empty>
          )}
          <DoneList tasks={d.doneForMe} label="Done & dusted" />
        </div>
      ) : (
        <div className="stack-sm">
          <button className="btn btn-caramel block" onClick={() => sheets.open({ kind: 'task' })}>
            <Plus size={18} /> New task for {p}
          </button>
          {[...d.tasksForPartner]
            .sort((a, b) => Number(d.pendingClaimByTask.has(b.id)) - Number(d.pendingClaimByTask.has(a.id)))
            .map((t) => (
              <TheirTaskCard key={t.id} task={t} />
            ))}
          {d.tasksForPartner.length === 0 && (
            <Empty title={`Give ${p} something to earn`}>Dishes, a foot rub, an epic playlist… anything you’d love them to do.</Empty>
          )}
          <DoneList tasks={d.doneForPartner} label="Done & dusted" />
        </div>
      )}
    </div>
  );
}

function DoneList({ tasks, label }: { tasks: { id: string; title: string; points: number; updated_at: string }[]; label: string }) {
  if (!tasks.length) return null;
  return (
    <details className="done-list">
      <summary>
        {label} <span className="seg-count">{tasks.length}</span>
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
