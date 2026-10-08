import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Heart, Share2 } from 'lucide-react';
import { useLoaded } from '../app/store';
import { BrownieIcon } from '../components/Brownie';
import { Avatar } from '../components/ui';
import { clearInvite, readInvite } from '../app/invite';

export function Pair() {
  const { state, backend, refresh, toast } = useLoaded();
  const me = state.me;
  const code = me.pair_code ?? '';
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // An invite for your own code (e.g. opened on the inviter's device) is ignored.
  const pendingInvite = (() => {
    const invite = readInvite();
    return invite && norm(invite) !== norm(code) ? invite : null;
  })();
  const [input, setInput] = useState(() => pendingInvite ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoTried = useRef(false);

  const inviteUrl = `${location.origin}${location.pathname}#join=${encodeURIComponent(code)}`;
  const inviteText = `Let’s do Brownie Points together 🍫 My pair code is ${code}`;

  async function pair(value = input) {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await backend.pairWith(value);
      if (res.ok) {
        clearInvite();
        await refresh();
        toast('You’re paired! Let the baking begin.', 'success');
      } else {
        setError(res.error ?? 'That didn’t work. Try again?');
        if (/own code|already paired/i.test(res.error ?? '')) clearInvite();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Opened from an invite link → try pairing straight away.
  useEffect(() => {
    if (pendingInvite && !autoTried.current) {
      autoTried.current = true;
      pair(pendingInvite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${inviteText}\n${inviteUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('Couldn’t copy. Long-press the code instead.', 'error');
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Brownie Points', text: inviteText, url: inviteUrl });
      } catch {
        /* user closed the share sheet */
      }
    } else copy();
  }

  return (
    <div className="pair-screen">
      <div className="pair-hero">
        <Avatar emoji={me.avatar} size={64} />
        <span className="pair-plus">
          <Heart size={22} fill="currentColor" />
        </span>
        <span className="avatar avatar-berry avatar-empty" style={{ width: 64, height: 64 }}>
          ?
        </span>
      </div>
      <h1 className="screen-title center">Pair up, {me.display_name}</h1>
      <p className="screen-sub center">Brownie Points is made for two. Send your partner your code, or type in theirs.</p>

      <section className="card code-card">
        <span className="kicker">Your code</span>
        <div className="code" aria-label={`Your code is ${code.split('').join(' ')}`}>
          {code}
        </div>
        <div className="row">
          <button className="btn btn-ghost grow" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy invite'}
          </button>
          <button className="btn btn-caramel grow" onClick={share}>
            <Share2 size={16} /> Share
          </button>
        </div>
      </section>

      <div className="or">
        <span>or</span>
      </div>

      <form
        className="card code-card"
        onSubmit={(e) => {
          e.preventDefault();
          pair();
        }}
      >
        <label className="field">
          <span className="field-label">Got their code?</span>
          <input
            className="code-input"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="FUDGE-7K2QX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-caramel block" disabled={busy || !input.trim()}>
          Pair up
        </button>
      </form>

      <p className="waiting-note">
        <BrownieIcon size={22} className="bob" /> We’ll connect you automatically when your partner enters your code.
      </p>
      <p className="muted small center">
        Not {me.display_name}?{' '}
        <button className="link inline" onClick={() => backend.signOut()}>
          Sign out
        </button>
      </p>
    </div>
  );
}
