import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, MailCheck, MailWarning, RefreshCw, Trash2, X } from 'lucide-react';
import { useLoaded } from '../app/store';
import { BrownieIcon } from '../components/Brownie';
import { AsyncButton, Avatar } from '../components/ui';
import type { AdminUser } from '../lib/types';
import { timeAgo } from '../lib/util';
import { useSheets } from './sheets';

/** Approve or reject sign-ups and manage members. Admins only (enforced by the database). */
export function AdminPortal() {
  const { backend, state, act } = useLoaded();
  const sheets = useSheets();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const approve = async (u: AdminUser) => {
    await act((b) => b.adminApprove(u.id), { success: `${u.display_name} is in!` });
    await load();
  };
  const remove = (u: AdminUser) =>
    sheets.open({
      kind: 'confirm',
      title: u.status === 'pending' ? `Reject ${u.display_name}?` : `Remove ${u.display_name}?`,
      body:
        u.status === 'pending' ? (
          <p>Their account ({u.email}) is deleted. They can sign up again later if they want.</p>
        ) : (
          <p>
            This deletes {u.display_name}’s account ({u.email}) along with every task and wish they made.
            {u.partner_name && <> {u.partner_name} is unpaired and keeps their own account.</>} This can’t be undone.
          </p>
        ),
      confirmLabel: u.status === 'pending' ? 'Reject & delete' : 'Remove account',
      danger: true,
      onConfirm: async () => {
        await act((b) => b.adminRemove(u.id), { success: u.status === 'pending' ? 'Sign-up rejected' : 'Account removed' });
        await load();
      },
    });

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
                <button className="btn btn-ghost sm danger-text" onClick={() => remove(u)}>
                  <X size={16} /> Reject
                </button>
                <AsyncButton className="btn btn-caramel sm" onClick={() => approve(u)}>
                  <Check size={16} /> Approve
                </AsyncButton>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">
            Members <span className="seg-count">{members.length}</span>
          </h2>
        </div>
        {members.length > 0 && (
          <ul className="card member-list">
            {members.map((u) => (
              <li key={u.id}>
                <Avatar emoji={u.avatar} size={38} tone={u.is_admin ? 'caramel' : 'berry'} />
                <div className="member-main">
                  <span className="member-name">
                    {u.display_name}
                    {u.id === state.me.id && <span className="tag">you</span>}
                    {u.is_admin && <span className="tag">admin</span>}
                  </span>
                  <span className="admin-email">{u.email}</span>
                  <span className="meta">
                    {u.partner_name ? `Paired with ${u.partner_name}` : 'Not paired yet'}
                    {u.last_sign_in_at && ` · seen ${timeAgo(u.last_sign_in_at)}`}
                  </span>
                </div>
                {u.id !== state.me.id && (
                  <button className="icon-btn sm" onClick={() => remove(u)} aria-label={`Remove ${u.display_name}`}>
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
