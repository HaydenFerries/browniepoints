import { useEffect, useState, type ComponentType } from 'react';
import { Gift, House, ListChecks, ScrollText } from 'lucide-react';
import { AppProvider, useApp, useLoaded } from './store';
import { BrownieIcon } from '../components/Brownie';
import { Drip } from '../components/Drip';
import { Avatar, Burst, Toasts } from '../components/ui';
import { Home } from '../screens/Home';
import { Tasks } from '../screens/Tasks';
import { Treats } from '../screens/Treats';
import { History } from '../screens/History';
import { Pair } from '../screens/Pair';
import { Waiting } from '../screens/Waiting';
import { AdminPortal } from '../screens/Admin';
import { NewPasswordSheet, Welcome } from '../screens/Welcome';
import { ProfileSheet } from '../screens/Profile';
import { SheetHost, useSheets } from '../screens/sheets';

export type Tab = 'home' | 'tasks' | 'treats' | 'history';
const TABS: { id: Tab; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'treats', label: 'Rewards', icon: Gift },
  { id: 'history', label: 'History', icon: ScrollText },
];

export default function App() {
  return (
    <AppProvider>
      <Backdrop />
      <Shell />
      <Toasts />
      <Burst />
    </AppProvider>
  );
}

function Backdrop() {
  return <div className="backdrop" aria-hidden="true" />;
}

function Shell() {
  const { status, state, loadError, recovery, backend, refresh } = useApp();
  const hash = useHash();
  const which =
    status === 'loading' || (status === 'signed-in' && !state && !loadError)
      ? 'splash'
      : status === 'signed-out'
        ? 'welcome'
        : !state
          ? 'error'
          : (state.me.status ?? 'approved') !== 'approved'
            ? 'waiting'
            : hash === 'admin' && state.me.is_admin
              ? 'admin'
              : !state.partner
                ? 'pair'
                : 'main';
  // each screen starts at the top (e.g. Welcome → Home after signing in)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [which]);

  let screen;
  if (which === 'splash') screen = <Splash />;
  else if (which === 'welcome') screen = <Welcome />;
  else if (which === 'error')
    screen = (
      <div className="center-screen">
        <BrownieIcon size={72} />
        <h2>The oven’s acting up</h2>
        <p className="muted">{loadError}</p>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => backend.signOut()}>
            Sign out
          </button>
          <button className="btn btn-caramel" onClick={() => refresh()}>
            Try again
          </button>
        </div>
      </div>
    );
  else if (which === 'waiting') screen = <Waiting />;
  else if (which === 'admin')
    screen = (
      <SheetHost renderProfile={() => null}>
        <AdminPortal />
      </SheetHost>
    );
  else if (which === 'pair') screen = <Pair />;
  else screen = <Main />;
  return (
    <>
      {screen}
      {recovery && <NewPasswordSheet />}
    </>
  );
}

function useHash() {
  const [hash, setHash] = useState(() => location.hash.replace('#', ''));
  useEffect(() => {
    const on = () => setHash(location.hash.replace('#', ''));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function Splash() {
  return (
    <div className="center-screen">
      <BrownieIcon size={96} className="bob" />
      <p className="muted">Warming up the oven…</p>
    </div>
  );
}

function useHashTab(): [Tab, (t: Tab) => void] {
  const read = (): Tab => {
    const h = location.hash.replace('#', '') as Tab;
    return TABS.some((t) => t.id === h) ? h : 'home';
  };
  const [tab, setTab] = useState<Tab>(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: Tab) => {
    if (t !== tab) location.hash = t === 'home' ? '' : t;
    setTab(t);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return [tab, go];
}

function Main() {
  const [tab, go] = useHashTab();
  return (
    <SheetHost renderProfile={(close) => <ProfileSheet onClose={close} />}>
      <div className="app">
        <TopBar />
        <main className="screen" key={tab}>
          {tab === 'home' && <Home go={go} />}
          {tab === 'tasks' && <Tasks />}
          {tab === 'treats' && <Treats />}
          {tab === 'history' && <History />}
        </main>
        <TabBar tab={tab} go={go} />
      </div>
    </SheetHost>
  );
}

function TopBar() {
  const { state, backend } = useLoaded();
  const sheets = useSheets();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <BrownieIcon size={34} />
          <span className="brand-name">
            Brownie <em>Points</em>
          </span>
          {backend.mode === 'demo' && <span className="demo-badge">demo</span>}
        </div>
        <button className="couple-btn" onClick={() => sheets.open({ kind: 'profile' })} aria-label="Your profile">
          <Avatar emoji={state.me.avatar} size={34} />
          {state.partner && <Avatar emoji={state.partner.avatar} tone="berry" size={34} />}
          {state.admin?.pending ? <span className="tab-badge couple-badge">{state.admin.pending}</span> : null}
        </button>
      </div>
      <Drip />
    </header>
  );
}

function TabBar({ tab, go }: { tab: Tab; go: (t: Tab) => void }) {
  const { d } = useLoaded();
  const badges: Partial<Record<Tab, number>> = {
    home: d.actionCount,
    tasks: d.claimsToReview.length,
    treats: d.toDeliver.length + d.toPrice.length,
  };
  return (
    <nav className="tabbar" aria-label="Sections">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button key={id} className={tab === id ? 'on' : ''} onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined}>
          <span className="tab-icon">
            <Icon size={22} strokeWidth={tab === id ? 2.4 : 1.9} />
            {badges[id] ? <span className="tab-badge">{badges[id]}</span> : null}
          </span>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
