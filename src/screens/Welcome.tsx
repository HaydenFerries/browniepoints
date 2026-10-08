import { useEffect, useState } from 'react';
import { ArrowRight, Heart } from 'lucide-react';
import { useApp } from '../app/store';
import { readInvite } from '../app/invite';
import { enterDemo, supabaseConfigured } from '../lib/backend';
import hero from '../assets/generated/hero.webp';
import { BrownieIcon } from '../components/Brownie';
import { Segmented, Sheet } from '../components/ui';
import { AVATARS } from './Profile';

const AUTOSEED = 'bp-demo-autoseed';

export function Welcome() {
  const { backend, toast } = useApp();
  const invite = readInvite();
  const [mode, setMode] = useState<'create' | 'signin'>(invite ? 'create' : 'create');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // "Try the demo" from the real app reloads into demo mode, then seeds here.
  useEffect(() => {
    if (backend.demo && sessionStorage.getItem(AUTOSEED) === '1') {
      sessionStorage.removeItem(AUTOSEED);
      backend.demo.seed();
    }
  }, [backend]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        const { needsConfirmation } = await backend.signUp({ email, password, displayName: name, avatar });
        if (needsConfirmation) setConfirmSent(true);
      } else {
        await backend.signIn(email, password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function tryDemo() {
    if (backend.demo) {
      backend.demo.seed();
    } else {
      enterDemo();
      sessionStorage.setItem(AUTOSEED, '1');
      location.reload();
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-hero" style={{ backgroundImage: `url(${hero})` }} aria-hidden="true">
        <div className="hero-fade" />
      </div>
      <div className="welcome-body">
        <h1 className="logo">
          <span className="logo-1">Brownie</span>
          <span className="logo-2">Points</span>
        </h1>
        <p className="tagline">Sweet rewards for the little things you do for each other.</p>

        {invite && (
          <div className="invite-banner">
            <Heart size={18} fill="currentColor" />
            <span>You’ve been invited to pair up! Make an account (or sign in) and we’ll connect you.</span>
          </div>
        )}

        {confirmSent ? (
          <div className="card confirm-sent">
            <h2>Check your inbox</h2>
            <p>
              We sent a link to <strong>{email}</strong>. Tap it to confirm, then come back and sign in.
            </p>
            <button
              className="btn btn-caramel block"
              onClick={() => {
                setConfirmSent(false);
                setMode('signin');
              }}
            >
              I’ve confirmed, sign in
            </button>
          </div>
        ) : (
          <form className="card auth-card" onSubmit={submit}>
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'create', label: 'New here' },
                { value: 'signin', label: 'Sign in' },
              ]}
            />
            {mode === 'create' && (
              <>
                <label className="field">
                  <span className="field-label">Your name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What your partner calls you" maxLength={40} required autoComplete="given-name" />
                </label>
                <div className="emoji-row compact" role="radiogroup" aria-label="Pick an avatar">
                  {AVATARS.slice(0, 10).map((e) => (
                    <button type="button" key={e} role="radio" aria-checked={e === avatar} className={e === avatar ? 'on' : ''} onClick={() => setAvatar(e)}>
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                placeholder={mode === 'create' ? 'At least 6 characters' : ''}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn btn-caramel block lg" disabled={busy}>
              {mode === 'create' ? 'Start baking' : 'Sign in'} <ArrowRight size={18} />
            </button>
            {mode === 'signin' && backend.mode === 'supabase' && (
              <button type="button" className="link center-block" onClick={() => setResetOpen(true)}>
                Forgot your password?
              </button>
            )}
          </form>
        )}

        <div className="demo-cta">
          {backend.mode === 'demo' && !supabaseConfigured && (
            <p className="muted small center">Demo mode: no server is connected yet, so accounts live in this browser.</p>
          )}
          <button className="btn btn-ghost block" onClick={tryDemo}>
            <BrownieIcon size={22} /> Just looking? Try it with sample data
          </button>
        </div>
      </div>
      {resetOpen && <ResetSheet initialEmail={email} onClose={() => setResetOpen(false)} onSent={() => toast('Reset link sent. Check your email.', 'success')} />}
    </div>
  );
}

function ResetSheet({ initialEmail, onClose, onSent }: { initialEmail: string; onClose: () => void; onSent: () => void }) {
  const { backend } = useApp();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Reset your password"
      subtitle="We’ll email you a link to set a new one."
      footer={
        <button
          className="btn btn-caramel grow"
          disabled={busy || !email}
          onClick={async () => {
            setBusy(true);
            try {
              await backend.requestPasswordReset(email);
              onSent();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Send link
        </button>
      }
    >
      <label className="field">
        <span className="field-label">Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      {error && <p className="form-error">{error}</p>}
    </Sheet>
  );
}

export function NewPasswordSheet() {
  const { backend, endRecovery, toast } = useApp();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      open
      onClose={endRecovery}
      title="Choose a new password"
      footer={
        <button
          className="btn btn-caramel grow"
          disabled={busy || password.length < 6}
          onClick={async () => {
            setBusy(true);
            try {
              await backend.updatePassword(password);
              toast('Password updated', 'success');
              endRecovery();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save password
        </button>
      }
    >
      <label className="field">
        <span className="field-label">New password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} autoComplete="new-password" />
      </label>
      {error && <p className="form-error">{error}</p>}
    </Sheet>
  );
}
