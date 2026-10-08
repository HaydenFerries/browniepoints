import { useEffect, useState } from 'react';
import { HeartCrack, LogOut, RefreshCw, ShieldCheck, Shuffle } from 'lucide-react';
import { useLoaded } from '../app/store';
import { leaveDemo } from '../lib/backend';
import { Avatar, Sheet } from '../components/ui';
import { useSheets } from './sheets';

export const AVATARS = ['🍫', '🧁', '🍪', '🍩', '🍰', '🍓', '🍒', '🍯', '☕', '🍦', '🥐', '🐻', '🦊', '🐰', '🐱', '🐶', '🌸', '🌙', '⭐', '💛'];

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { state, backend, act } = useLoaded();
  const sheets = useSheets();
  const partner = state.partner;
  const [name, setName] = useState(state.me.display_name);
  const [avatar, setAvatar] = useState(state.me.avatar);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    backend.currentEmail().then(setEmail);
  }, [backend]);
  const dirty = name.trim() !== state.me.display_name || avatar !== state.me.avatar;

  async function save() {
    setBusy(true);
    await act((b) => b.updateProfile(name, avatar), { success: 'Profile saved' });
    setBusy(false);
  }

  // activity is newest-first, so this is the most recent pairing
  const since = partner ? state.activity.find((a) => a.kind === 'paired')?.created_at : undefined;
  const demoPartner = backend.demo?.users().find((u) => u.id !== state.me.id);

  return (
    <Sheet open onClose={onClose} title="Your profile">
      <section className="profile-section">
        <div className="profile-preview">
          <Avatar emoji={avatar} size={64} />
          <label className="field grow">
            <span className="field-label">Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </label>
        </div>
        <div className="emoji-row" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((e) => (
            <button key={e} role="radio" aria-checked={e === avatar} className={e === avatar ? 'on' : ''} onClick={() => setAvatar(e)}>
              {e}
            </button>
          ))}
        </div>
        <button className="btn btn-caramel block" disabled={!dirty || busy || !name.trim()} onClick={save}>
          Save
        </button>
      </section>

      {partner && (
        <section className="profile-section">
          <h3 className="mini-title">Your sweetheart</h3>
          <div className="pair-row">
            <Avatar emoji={state.me.avatar} size={36} />
            <Avatar emoji={partner.avatar} tone="berry" size={36} />
            <div className="grow">
              <strong>
                {state.me.display_name} &amp; {partner.display_name}
              </strong>
              {since && <span className="muted small block">Baking together since {new Date(since).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
            </div>
          </div>
          <button
            className="btn btn-ghost block danger-text"
            onClick={() =>
              sheets.open({
                kind: 'confirm',
                title: `Unpair from ${partner.display_name}?`,
                body: (
                  <p>
                    You’ll both go back to the pairing screen. Your tasks, wishes and brownies are kept, and they come back if you two pair up again.
                  </p>
                ),
                confirmLabel: 'Unpair',
                danger: true,
                onConfirm: () => act((b) => b.unpair()),
              })
            }
          >
            <HeartCrack size={16} /> Unpair
          </button>
        </section>
      )}

      {state.me.is_admin && (
        <section className="profile-section">
          <h3 className="mini-title">Admin</h3>
          <button
            className="btn btn-ghost block"
            onClick={() => {
              onClose();
              location.hash = 'admin';
            }}
          >
            <ShieldCheck size={16} /> Open admin portal
            {state.admin?.pending ? <span className="badge">{state.admin.pending} waiting</span> : null}
          </button>
        </section>
      )}

      {backend.demo && (
        <section className="profile-section demo-box">
          <h3 className="mini-title">Demo mode</h3>
          <p className="muted small">Everything lives in this browser. Open a second tab to play the other partner, or switch here.</p>
          <div className="row wrap">
            {demoPartner && (
              <button className="btn btn-ghost sm" onClick={() => backend.demo!.switchUser(demoPartner.id).then(onClose)}>
                <Shuffle size={15} /> Be {demoPartner.display_name}
              </button>
            )}
            <button
              className="btn btn-ghost sm"
              onClick={() => {
                backend.demo!.reset();
                onClose();
              }}
            >
              <RefreshCw size={15} /> Reset demo
            </button>
            {import.meta.env.VITE_SUPABASE_URL && (
              <button
                className="btn btn-ghost sm"
                onClick={() => {
                  leaveDemo();
                  location.reload();
                }}
              >
                Exit demo
              </button>
            )}
          </div>
        </section>
      )}

      <section className="profile-section">
        <h3 className="mini-title">Account</h3>
        {email && <p className="muted small">{email}</p>}
        <button className="btn btn-ghost block" onClick={() => backend.signOut().then(onClose)}>
          <LogOut size={16} /> Sign out
        </button>
      </section>

      <p className="credits">
        Brownie photos:{' '}
        <a href="https://commons.wikimedia.org/wiki/File:Chocolatebrownie.JPG" target="_blank" rel="noreferrer">
          Ɱ / Wikimedia Commons
        </a>{' '}
        (CC BY-SA 3.0, cut out) ·{' '}
        <a href="https://unsplash.com/photos/a-stack-of-brownies-sitting-on-top-of-a-white-plate-f979oad8TDs" target="_blank" rel="noreferrer">
          Eve Maier / Unsplash
        </a>
      </p>
    </Sheet>
  );
}
