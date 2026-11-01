import { useState } from 'preact/hooks';
import { createProfile, loading, profile, profiles, selectProfile } from '../state';
import { StatusBar } from './StatusBar';
import { MistakesView } from './MistakesView';
import { OpeningsView } from './OpeningsView';
import { DrillView } from './DrillView';
import { ImportButton, LinkAccountForm, ProfileView } from './ProfileView';
import { go, tab, type Tab } from './drill-request';
import { insightShown } from '../insight';

const TABS: { id: Tab; label: string }[] = [
  { id: 'mistakes', label: 'Mistakes' },
  { id: 'openings', label: 'Openings' },
  { id: 'drill', label: 'Drill' },
  { id: 'profile', label: 'Profile' },
];

export function App() {
  if (loading.value) return <p class="center muted">Loading…</p>;
  const p = profile.value;
  if (!p) return <Welcome />;
  if (!p.accounts.length) return <FirstAccount />;
  const t = tab.value;
  return (
    <>
      <header class="top">
        <h1>chessprac</h1>
        <ProfileSwitcher />
        {insightShown.value && !insightShown.value.seenAt && t !== 'mistakes' && (
          <button class="pill" onClick={() => go('mistakes')}>
            New insight
          </button>
        )}
        <nav class="tabs">
          {TABS.map((x) => (
            <button class={t === x.id ? 'tab on' : 'tab'} aria-current={t === x.id ? 'page' : undefined} onClick={() => go(x.id)}>
              {x.label}
            </button>
          ))}
        </nav>
      </header>
      <StatusBar />
      <main>
        {t === 'mistakes' && <MistakesView />}
        {t === 'openings' && <OpeningsView />}
        {/* Kept mounted so a drill session survives a look at another tab. */}
        <DrillView key={p.id} active={t === 'drill'} />
        {t === 'profile' && <ProfileView />}
      </main>
      <footer>
        Analysis by{' '}
        <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">
          Stockfish.js
        </a>{' '}
        (GPL-3.0, <a href="engine/COPYING.txt">licence</a>). Opening names from the{' '}
        <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener">
          Lichess opening book
        </a>
        . Games from the chess.com and Lichess public APIs. Your data stays in this browser.
      </footer>
    </>
  );
}

function ProfileSwitcher() {
  const p = profile.value!;
  return (
    <select
      class="profile-switch"
      value={p.id}
      aria-label="Profile"
      onChange={async (e) => {
        const v = e.currentTarget.value;
        if (v === '__new') {
          const name = prompt('Name for the new profile');
          if (name) await createProfile(name);
          else e.currentTarget.value = p.id;
        } else await selectProfile(v);
      }}
    >
      {profiles.value.map((x) => (
        <option value={x.id}>{x.name}</option>
      ))}
      <option value="__new">New profile…</option>
    </select>
  );
}

function Welcome() {
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div class="welcome">
      <h1>chessprac</h1>
      <p>
        Pulls your chess.com and Lichess games into one place, finds the positions in the first 20 moves where you keep
        going wrong, and drills them until the right move is automatic.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await createProfile(name || 'Me');
        }}
      >
        <label>
          Profile name{' '}
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Me" />
        </label>
        <button class="primary">Create profile</button>
      </form>
      <p class="muted">Or restore one you exported earlier:</p>
      <ImportButton onDone={setMessage} />
      {message && <p>{message}</p>}
    </div>
  );
}

function FirstAccount() {
  const p = profile.value!;
  return (
    <div class="welcome">
      <h1>{p.name}</h1>
      <p>
        Link a chess.com or Lichess account to start. You can link the other site (or more accounts) later; their games merge
        into the same profile.
      </p>
      <LinkAccountForm submitLabel="Link and import" />
      <p class="muted">
        Import, then analysis, run in the background. The first analysis takes a while (a few hundred games is a few minutes to
        an hour, depending on your computer), and it picks up where it left off if you close the tab.
      </p>
    </div>
  );
}
