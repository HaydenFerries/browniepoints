import { useState } from 'react';
import { ChevronRight, HeartHandshake, ListPlus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useLoaded } from '../app/store';
import { BrownieIcon } from '../components/Brownie';
import { Jar } from '../components/Jar';
import { Avatar, CountUp } from '../components/ui';
import { Feed } from './History';
import { DeliverCard, PriceCard, ReviewClaimCard, WaitingRow } from './cards';
import { useSheets } from './sheets';
import type { Tab } from '../app/App';

const INTRO_KEY = 'bp-intro-dismissed';

export function Home({ go }: { go: (t: Tab) => void }) {
  const { state, d, act } = useLoaded();
  const sheets = useSheets();
  const partner = state.partner!;
  const p = partner.display_name;
  const [introHidden, setIntroHidden] = useState(() => {
    try {
      return localStorage.getItem(INTRO_KEY) === '1';
    } catch {
      return false;
    }
  });
  const hideIntro = () => {
    setIntroHidden(true);
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* private mode */
    }
  };
  const waitingCount = d.myClaimsWaiting.length + d.owedToMe.length;

  return (
    <div className="stack">
      <section className="jars" aria-label="Brownie balances">
        <JarCard name="You" emoji={state.me.avatar} balance={d.myBalance} earned={d.myEarned} accent="caramel" onClick={() => go('treats')} />
        <JarCard name={p} emoji={partner.avatar} balance={d.partnerBalance} earned={d.partnerEarned} accent="berry" onClick={() => go('history')} />
      </section>

      {partner.status === 'suspended' && (
        <section className="card partner-note" role="status">
          <Avatar emoji={partner.avatar} tone="berry" size={36} />
          <span>
            <strong>{p}’s account is suspended.</strong> They can’t use Brownie Points until an admin restores it. Everything
            is kept.
          </span>
        </section>
      )}

      {!introHidden && (
        <section className="card intro">
          <button className="icon-btn intro-close" onClick={hideIntro} aria-label="Hide how it works">
            <X size={18} />
          </button>
          <h2>How it works</h2>
          <ol>
            <li>
              <span>
                <strong>Set tasks for {p}</strong> and decide how many brownies each one is worth.
              </span>
            </li>
            <li>
              <span>
                <strong>Add wishes</strong> you’d love from {p}. They set the price, you set theirs.
              </span>
            </li>
            <li>
              <span>
                <strong>Do tasks, earn brownies,</strong> then cash them in for treats.
              </span>
            </li>
          </ol>
        </section>
      )}

      <section>
        <div className="section-head">
          <h2 className="section-title">
            Fresh from the oven {d.actionCount > 0 && <span className="badge">{d.actionCount}</span>}
          </h2>
        </div>
        <div className="stack-sm">
          {state.admin?.pending ? (
            <article className="card action-card needs-you">
              <div className="ac-icon">
                <ShieldCheck size={20} />
              </div>
              <div className="ac-main">
                <p className="kicker">Admin</p>
                <h3>
                  {state.admin.pending} {state.admin.pending === 1 ? 'person wants' : 'people want'} in
                </h3>
                <p className="meta">New sign-ups wait for your approval.</p>
              </div>
              <div className="ac-actions">
                <button className="btn btn-caramel sm" onClick={() => (location.hash = 'admin')}>
                  Review sign-ups
                </button>
              </div>
            </article>
          ) : null}
          {d.claimsToReview.map((c) => (
            <ReviewClaimCard key={c.id} claim={c} />
          ))}
          {d.toDeliver.map((r) => (
            <DeliverCard key={r.id} redemption={r} />
          ))}
          {d.toPrice.map((r) => (
            <PriceCard key={r.id} reward={r} />
          ))}
          {d.actionCount === 0 && !state.admin?.pending && (
            <div className="all-clear">
              <BrownieIcon size={40} />
              <div>
                <strong>All caught up.</strong>
                <span>Nothing needs you right now.</span>
              </div>
            </div>
          )}
          {waitingCount > 0 && (
            <div className="card waiting-card">
              {d.myClaimsWaiting.map((c) => (
                <WaitingRow
                  key={c.id}
                  kicker={`Waiting for ${p} to approve`}
                  title={d.taskById.get(c.task_id)?.title ?? 'A task'}
                  onUndo={() => act((b) => b.withdrawClaim(c.id))}
                />
              ))}
              {d.owedToMe.map((r) => (
                <WaitingRow key={r.id} emoji={r.emoji} kicker={`${p} owes you`} title={r.title} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="quick" aria-label="Quick actions">
        <button className="quick-btn" onClick={() => sheets.open({ kind: 'task' })}>
          <ListPlus size={22} />
          <span>Task for {p}</span>
        </button>
        <button className="quick-btn" onClick={() => sheets.open({ kind: 'wish' })}>
          <Sparkles size={22} />
          <span>Add a wish</span>
        </button>
        <button className="quick-btn" onClick={() => sheets.open({ kind: 'gift' })}>
          <HeartHandshake size={22} />
          <span>Treat {p}</span>
        </button>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Lately</h2>
          <button className="link" onClick={() => go('history')}>
            See all <ChevronRight size={16} />
          </button>
        </div>
        <Feed items={state.activity.slice(0, 5)} />
      </section>
    </div>
  );
}

function JarCard({
  name,
  emoji,
  balance,
  earned,
  accent,
  onClick,
}: {
  name: string;
  emoji: string;
  balance: number;
  earned: number;
  accent: 'caramel' | 'berry';
  onClick: () => void;
}) {
  return (
    <button className={`jar-card jar-card-${accent}`} onClick={onClick}>
      <span className="jar-card-head">
        <Avatar emoji={emoji} tone={accent} size={28} />
        <span className="jar-name">{name}</span>
      </span>
      <Jar balance={balance} accent={accent} />
      <span className="jar-count">
        <CountUp value={balance} />
      </span>
      <span className="jar-label">brownies</span>
      <span className="jar-earned">{earned} earned all-time</span>
    </button>
  );
}
