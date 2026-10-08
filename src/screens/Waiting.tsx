import { LogOut } from 'lucide-react';
import { useLoaded } from '../app/store';
import { Jar } from '../components/Jar';
import { Avatar } from '../components/ui';
import { timeAgo } from '../lib/util';

/** Shown to accounts an admin hasn't approved yet. The app polls and listens
 *  for the approval, so this moves on by itself. */
export function Waiting() {
  const { state, backend } = useLoaded();
  const me = state.me;
  return (
    <div className="waiting-screen">
      <div className="waiting-jar">
        <Jar balance={0} />
      </div>
      <span className="kicker center">Invite only</span>
      <h1 className="screen-title center">Account waiting for approval</h1>
      <p className="screen-sub center">
        Thanks for signing up, {me.display_name}! Someone needs to let you in before you can pair up and start
        baking. This page updates by itself once you’re approved.
      </p>

      <div className="card waiting-status">
        <Avatar emoji={me.avatar} size={44} />
        <div className="grow">
          <strong>{me.display_name}</strong>
          <span className="muted small block">Signed up {timeAgo(me.created_at)}</span>
        </div>
        <span className="status-pill">
          <span className="pulse-dot" /> Pending
        </span>
      </div>

      <p className="muted small center">Know who runs this? Give them a nudge.</p>
      <button className="btn btn-ghost center-block" onClick={() => backend.signOut()}>
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
