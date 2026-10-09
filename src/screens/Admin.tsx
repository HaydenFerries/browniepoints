import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, Check, MailCheck, MailWarning, MoreHorizontal, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { useLoaded } from '../app/store';
import { BrownieIcon } from '../components/Brownie';
import { AsyncButton, Avatar, Sheet } from '../components/ui';
import type { AccountStatus, AdminUser } from '../lib/types';
import { timeAgo } from '../lib/util';

type Action = { user: AdminUser; mode: 'reject' | 'manage' };

/** Approve, reject, suspend, restore or delete accounts. Admins only (enforced by the database). */
export function AdminPortal() {
  const { backend, state, act } = useLoaded();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await backend.adminListUsers());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backend]);

  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    const timer = setInterval(onVisible, 10000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const pending = users?.filter((u) => u.status === 'pending') ?? [];
  const members = users?.filter((u) => u.status === 'approved') ?? [];
  const blocked = users?.filter((u) => u.status === 'suspended' || u.status === 'rejected') ?? [];

  const setStatus = async (u: AdminUser, status: Exclude<AccountStatus, 'pending'>, note = '') => {
    const messages = {
      approved: u.status === 'pending' ? `${u.display_name} is in!` : `${u.display_name} is back in`,
      suspended: `${u.display_name} is suspended`,
      rejected: `${u.display_name}’s sign-up was rejected`,
    };
    const ok = await act((b) => b.adminSetStatus(u.id, status, note), { success: messages[status] });
    await load();
    return ok;
  };
  const remove = async (u: AdminUser) => {
    const ok = await act((b) => b.adminRemove(u.id), { success: 'Account deleted' });
    await load();
    return ok;
  };

  return (
    <div className="admin-screen">
      <header className="admin-head">
        <button className="icon-btn" onClick={() => (location.hash = '')} aria-label="Back to the app">
          <ArrowLeft size={20} />
        </button>
        <div className="grow">
          <h1 className="screen-title">Admin</h1>
          <p className="screen-sub">Decide who gets into the bakery.</p>
        </div>
        <button className="icon-btn" onClick={load} aria-label="Refresh">
          <RefreshCw size={18} />
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}

      <section>
        <div className="section-head">
          <h2 className="section-title">
            Waiting for approval {pending.length > 0 && <span className="badge">{pending.length}</span>}
          </h2>
        </div>
        <div className="stack-sm">
          {users === null && !error && <p className="muted">Loading…</p>}
          {users !== null && pending.length === 0 && (
            <div className="all-clear">
              <BrownieIcon size={40} />
              <div>
                <strong>No one’s waiting.</strong>
                <span>New sign-ups show up here for you to approve.</span>
              </div>
            </div>
          )}
          {pending.map((u) => (
            <article key={u.id} className="card action-card needs-you">
              <div className="ac-emoji">{u.avatar}</div>
              <div className="ac-main">
                <p className="kicker">Wants in · {timeAgo(u.created_at)}</p>
                <h3>{u.display_name}</h3>
                <p className="admin-email">{u.email}</p>
                <p className="meta">
                  {u.email_confirmed_at ? (
                    <>
                      <MailCheck size={14} /> Email confirmed
                    </>
                  ) : (
                    <>
                      <MailWarning size={14} /> Email not confirmed yet
                    </>
                  )}
                </p>
              </div>
              <div className="ac-actions">
                <button className="btn btn-ghost sm danger-text" onClick={() => setAction({ user: u, mode: 'reject' })}>
                  <X size={16} /> Reject
                </button>
                <AsyncButton className="btn btn-caramel sm" onClick={() => setStatus(u, 'approved')}>
                  <Check size={16} /> Approve
                </AsyncButton>
              </div>
            </article>
          ))}
        </div>
      </section>

      <UserList title="Members" users={members} meId={state.me.id} onManage={(u) => setAction({ user: u, mode: 'manage' })} />
      <UserList
        title="Suspended & rejected"
        users={blocked}
        meId={state.me.id}
        onManage={(u) => setAction({ user: u, mode: 'manage' })}
        hideWhenEmpty
      />

      {action && (
        <ManageSheet
          key={action.user.id + action.mode}
          user={action.user}
          mode={action.mode}
          onClose={() => setAction(null)}
          onSetStatus={setStatus}
          onRemove={remove}
        />
      )}
    </div>
  );
}

function UserList({
  title,
  users,
  meId,
  onManage,
  hideWhenEmpty,
}: {
  title: string;
  users: AdminUser[];
  meId: string;
  onManage: (u: AdminUser) => void;
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && users.length === 0) return null;
  return (
    <section>
      <div className="section-head">
        <h2 className="section-title">
          {title} <span className="seg-count">{users.length}</span>
        </h2>
      </div>
      {users.length > 0 && (
        <ul className="card member-list">
          {users.map((u) => (
            <li key={u.id} className={u.status !== 'approved' ? 'is-blocked' : ''}>
              <Avatar emoji={u.avatar} size={38} tone={u.is_admin ? 'caramel' : 'berry'} />
              <div className="member-main">
                <span className="member-name">
                  {u.display_name}
                  {u.id === meId && <span className="tag">you</span>}
                  {u.is_admin && <span className="tag">admin</span>}
                  {u.status === 'suspended' && <span className="tag tag-alert">suspended</span>}
                  {u.status === 'rejected' && <span className="tag tag-alert">rejected</span>}
                </span>
                <span className="admin-email">{u.email}</span>
                <span className="meta">
                  {u.status === 'approved'
                    ? u.partner_name
                      ? `Paired with ${u.partner_name}`
                      : 'Not paired yet'
                    : u.status_note
                      ? `“${u.status_note}”`
                      : u.status_changed_at
                        ? `Since ${timeAgo(u.status_changed_at)}`
                        : ''}
                  {u.status === 'approved' && u.last_sign_in_at && ` · seen ${timeAgo(u.last_sign_in_at)}`}
                </span>
              </div>
              {u.id !== meId && (
                <button className="icon-btn sm" onClick={() => onManage(u)} aria-label={`Manage ${u.display_name}`}>
                  <MoreHorizontal size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Reject a sign-up, or manage an existing account (suspend / restore / delete). */
function ManageSheet({
  user,
  mode,
  onClose,
  onSetStatus,
  onRemove,
}: {
  user: AdminUser;
  mode: 'reject' | 'manage';
  onClose: () => void;
  onSetStatus: (u: AdminUser, s: Exclude<AccountStatus, 'pending'>, note?: string) => Promise<boolean>;
  onRemove: (u: AdminUser) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) onClose();
  };

  const canBlock = mode === 'reject' || user.status === 'approved';
  const blockAs = mode === 'reject' || user.status === 'pending' ? 'rejected' : 'suspended';
  const deleteButton = confirmDelete ? (
    <button className="btn btn-danger" disabled={busy} onClick={() => run(() => onRemove(user))}>
      Really delete?
    </button>
  ) : (
    <button className="btn btn-ghost danger-text" onClick={() => setConfirmDelete(true)}>
      <Trash2 size={16} /> Delete
    </button>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <>
          <span className="sheet-emoji">{user.avatar}</span> {user.display_name}
        </>
      }
      subtitle={user.email ?? undefined}
      footer={
        <>
          {deleteButton}
          {canBlock ? (
            <button className="btn btn-berry grow" disabled={busy} onClick={() => run(() => onSetStatus(user, blockAs, note))}>
              <Ban size={16} /> {blockAs === 'rejected' ? 'Reject' : 'Suspend'}
            </button>
          ) : (
            <button className="btn btn-caramel grow" disabled={busy} onClick={() => run(() => onSetStatus(user, 'approved'))}>
              <RotateCcw size={16} /> {user.status === 'rejected' ? 'Approve after all' : 'Restore access'}
            </button>
          )}
        </>
      }
    >
      {canBlock ? (
        <>
          <p className="confirm-body">
            {blockAs === 'rejected'
              ? 'They’ll see that their sign-up wasn’t approved. Their account is kept, so you can still approve them later.'
              : `They’ll see that their account is suspended and can’t use Brownie Points until you restore it. Nothing is deleted${
                  user.partner_name ? `, and ${user.partner_name} stays paired with them` : ''
                }.`}
          </p>
          <label className="field">
            <span className="field-label">
              Message for them <em>optional</em>
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder={blockAs === 'rejected' ? 'Sorry, this is just for friends' : 'Taking a little break'}
            />
          </label>
        </>
      ) : (
        <p className="confirm-body">
          {user.status === 'rejected' ? 'Their sign-up was rejected' : 'Suspended'}
          {user.status_changed_at ? ` ${timeAgo(user.status_changed_at)}` : ''}
          {user.status_note ? <> with the message “{user.status_note}”.</> : '.'} Restoring gives them full access again, with everything they had before.
        </p>
      )}
      <p className="muted small">Delete removes the account and everything they created, for good.</p>
    </Sheet>
  );
}
