import { LogOut } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Jar } from '../components/Jar';
import { Avatar } from '../components/ui';
import { timeAgo } from '../lib/util';

const COPY = {
  pending: {
    kicker: 'Invite only',
    title: 'Account waiting for approval',
    body: (name: string) =>
      `Thanks for signing up, ${name}! Someone needs to let you in before you can pair up and start baking. This page updates by itself once you’re approved.`,
    pill: 'Pending',
    hint: 'Know who runs this? Give them a nudge.',
  },
  rejected: {
    kicker: 'Invite only',
    title: 'Your sign-up wasn’t approved',
    body: (name: string) => `Sorry, ${name}. Brownie Points is invite-only and this account hasn’t been let in.`,
    pill: 'Not approved',
    hint: 'If you think this is a mistake, contact whoever runs this Brownie Points.',
  },
  suspended: {
    kicker: 'Account on hold',
    title: 'Your account is suspended',
    body: (name: string) =>
      `Sorry, ${name}. Your account has been paused by an admin. Your brownies and history are safe, and this page updates by itself if access is restored.`,
    pill: 'Suspended',
    hint: 'If you think this is a mistake, contact whoever runs this Brownie Points.',
  },
} as const;

/** Shown to accounts that aren't approved (pending, rejected or suspended).
 *  The app keeps polling and listening, so this moves on by itself. */
export function Waiting() {
  const { state, backend } = useLoaded();
  const me = state.me;
  const status = me.status === 'rejected' || me.status === 'suspended' ? me.status : 'pending';
  const copy = COPY[status];
  return (
    <div className={`waiting-screen status-${status}`}>
      <div className="waiting-jar">
        <Jar balance={0} accent={status === 'pending' ? 'caramel' : 'berry'} />
      </div>
      <span className="kicker center">{copy.kicker}</span>
      <h1 className="screen-title center">{copy.title}</h1>
      <p className="screen-sub center">{copy.body(me.display_name)}</p>

      {me.status_note && status !== 'pending' && <p className="quote center status-note">“{me.status_note}”</p>}

      <div className="card waiting-status">
        <Avatar emoji={me.avatar} size={44} tone={status === 'pending' ? 'caramel' : 'berry'} />
        <div className="grow">
          <strong>{me.display_name}</strong>
          <span className="muted small block">Signed up {timeAgo(me.created_at)}</span>
        </div>
        <span className="status-pill">
          {status === 'pending' && <span className="pulse-dot" />} {copy.pill}
        </span>
      </div>

      <p className="muted small center">{copy.hint}</p>
      <button className="btn btn-ghost center-block" onClick={() => backend.signOut()}>
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
