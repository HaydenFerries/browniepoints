import { useState } from 'react';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { useApp } from './store';
import { useNow } from './useNow';
import { Sheet } from '../components/ui';
import type { FailedOp } from '../lib/backend/offline';
import { timeAgo } from '../lib/util';

/** A slim pill under the top bar: offline, syncing, or something couldn't sync. */
export function SyncBar() {
  const { sync } = useApp();
  const [open, setOpen] = useState(false);
  useNow(30_000); // keep "last synced 5 min ago" fresh
  if (!sync) return null;
  const waiting = sync.pending.length;
  const offline = !sync.online || sync.fromCache;
  let pill = null;
  if (sync.failed.length) {
    pill = (
      <button className="sync-pill sync-pill-alert" onClick={() => setOpen(true)}>
        <AlertTriangle size={16} />
        {sync.failed.length === 1 ? '1 change couldn’t sync' : `${sync.failed.length} changes couldn’t sync`}
        <strong>Review</strong>
      </button>
    );
  } else if (offline) {
    pill = (
      <button className="sync-pill" onClick={() => setOpen(true)}>
        <CloudOff size={16} />
        <span>
          Offline{sync.lastSynced ? ` · synced ${timeAgo(sync.lastSynced)}` : ''}
          {waiting ? ` · ${waiting} waiting` : ''}
        </span>
      </button>
    );
  } else if (waiting) {
    pill = (
      <button className="sync-pill" onClick={() => setOpen(true)}>
        <RefreshCw size={16} className="spin" />
        Syncing {waiting === 1 ? '1 change' : `${waiting} changes`}…
      </button>
    );
  }
  return (
    <>
      {pill && <div className="sync-row">{pill}</div>}
      {open && <SyncSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function SyncSheet({ onClose }: { onClose: () => void }) {
  const { sync, backend, state } = useApp();
  const control = backend.sync;
  if (!sync || !control) return null;
  const offline = !sync.online || sync.fromCache;
  const partner = state?.partner?.display_name ?? 'your partner';
  return (
    <Sheet
      open
      onClose={onClose}
      title={sync.failed.length ? 'Couldn’t sync' : offline ? 'You’re offline' : sync.pending.length ? 'Syncing' : 'All synced'}
      subtitle={
        offline
          ? `Keep going: changes are saved on this phone and sync by themselves when you’re back online.${sync.lastSynced ? ` Last synced ${timeAgo(sync.lastSynced)}.` : ''}`
          : undefined
      }
    >
      {sync.failed.length > 0 && (
        <section className="stack-sm">
          <p className="muted small">
            These didn’t go through, usually because {partner} changed the same thing meanwhile. Nothing’s been lost: choose what to do with each.
          </p>
          {sync.failed.map((f) => (
            <FailedRow key={f.id} op={f} partner={partner} />
          ))}
        </section>
      )}
      {sync.pending.length > 0 && (
        <section className="stack-sm">
          <h3 className="mini-title">Waiting to sync</h3>
          <ul className="sync-list">
            {sync.pending.map((p) => (
              <li key={p.id}>
                <span>{p.label || 'A change'}</span>
                <span className="muted small">{timeAgo(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!sync.failed.length && !sync.pending.length && <p className="muted">Everything’s synced. 🍫</p>}
      {sync.online && sync.pending.length > 0 && (
        <button className="btn btn-ghost block" disabled={sync.syncing} onClick={() => control.flush()}>
          <RefreshCw size={16} className={sync.syncing ? 'spin' : ''} /> {sync.syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </Sheet>
  );
}

function FailedRow({ op, partner }: { op: FailedOp; partner: string }) {
  const { backend, refresh } = useApp();
  const control = backend.sync!;
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    await refresh();
    setBusy(false);
  };
  return (
    <div className="sync-failed">
      <strong>{op.label || 'A change'}</strong>
      <span className="muted small">
        {op.reason} · {timeAgo(op.createdAt)}
      </span>
      <div className="row">
        {op.conflict ? (
          <>
            <button className="btn btn-ghost sm grow" disabled={busy} onClick={() => run(() => control.discard(op.id))}>
              Keep {partner}’s
            </button>
            <button className="btn btn-caramel sm grow" disabled={busy} onClick={() => run(() => control.useMine(op.id))}>
              Use mine
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost sm grow" disabled={busy} onClick={() => run(() => control.discard(op.id))}>
              Discard
            </button>
            <button className="btn btn-caramel sm grow" disabled={busy} onClick={() => run(() => control.retry(op.id))}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
