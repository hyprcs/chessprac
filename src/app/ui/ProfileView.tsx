import { useState } from 'preact/hooks';
import type { Account, Settings, Site } from '../../core/types';
import {
  changeImportWindow,
  exportProfile,
  games,
  importProfile,
  linkAccount,
  profile,
  removeProfile,
  renameProfile,
  syncAll,
  syncStatus,
  unlinkAccount,
  updateSettings,
} from '../state';
import { startAnalysis } from '../analysis';
import { autoWorkers } from '../engine';
import { SITE_NAMES, day, latestRatings, pawns, plural } from './format';

export const WINDOWS: { label: string; months: number | null }[] = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
  { label: 'All history', months: null },
];

export function windowStart(months: number | null): number | undefined {
  if (months === null) return undefined;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

/** Site + username + window form; used on first run and for linking more accounts. */
export function LinkAccountForm({ onLinked, submitLabel = 'Link and import' }: { onLinked?: () => void; submitLabel?: string }) {
  const [site, setSite] = useState<Site>('chesscom');
  const [username, setUsername] = useState('');
  const [months, setMonths] = useState<number | null>(6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      class="link-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!username.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await linkAccount(site, username, windowStart(months));
          setUsername('');
          onLinked?.();
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <select value={site} onChange={(e) => setSite((e.target as HTMLSelectElement).value as Site)} aria-label="Site">
        <option value="chesscom">chess.com</option>
        <option value="lichess">Lichess</option>
      </select>
      <input
        value={username}
        onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
        placeholder="username"
        aria-label="Username"
        autocomplete="off"
        spellcheck={false}
      />
      <select value={String(months)} onChange={(e) => setMonths(e.currentTarget.value === 'null' ? null : Number(e.currentTarget.value))} aria-label="Games to import">
        {WINDOWS.map((w) => (
          <option value={String(w.months)}>{w.label}</option>
        ))}
      </select>
      <button class="primary" disabled={busy || !username.trim()}>
        {busy ? 'Checking…' : submitLabel}
      </button>
      {error && <p class="error">{error}</p>}
    </form>
  );
}

function AccountRow({ a }: { a: Account }) {
  const n = games.value.filter((g) => g.site === a.site && g.account === a.username).length;
  const [editing, setEditing] = useState(false);
  return (
    <li class="account">
      <div>
        <strong>{SITE_NAMES[a.site]}</strong> {a.username}
        <div class="muted">
          {plural(n, 'game')} · from {a.sync.from ? day(a.sync.from) : 'the start'}
          {a.sync.lastSyncAt ? ` · synced ${day(a.sync.lastSyncAt)}` : ' · not synced yet'}
        </div>
      </div>
      <div class="actions">
        {editing ? (
          <select
            aria-label="Import from"
            onChange={(e) => {
              const v = e.currentTarget.value;
              setEditing(false);
              if (v) void changeImportWindow(a.site, a.username, windowStart(v === 'null' ? null : Number(v)));
            }}
          >
            <option value="">Import from…</option>
            {WINDOWS.map((w) => (
              <option value={String(w.months)}>{w.label}</option>
            ))}
          </select>
        ) : (
          <button class="small" onClick={() => setEditing(true)} disabled={syncStatus.value.running}>
            Change window
          </button>
        )}
        <button
          class="small danger"
          onClick={() => {
            if (confirm(`Unlink ${SITE_NAMES[a.site]} ${a.username}? Its games leave this profile.`)) void unlinkAccount(a.site, a.username);
          }}
        >
          Unlink
        </button>
      </div>
    </li>
  );
}

function NumberSetting({ label, hint, value, min, max, step = 1, onChange }: { label: string; hint?: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label class="setting">
      <span>
        {label}
        {hint && <span class="muted"> {hint}</span>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.currentTarget.value);
          if (n >= min && n <= max) onChange(n);
        }}
      />
    </label>
  );
}

export function ProfileView() {
  const p = profile.value!;
  const s = p.settings;
  const [message, setMessage] = useState<string | null>(null);
  const ratings = latestRatings(games.value);
  const set = async (patch: Partial<Settings>, reanalyse = false) => {
    await updateSettings(patch);
    if (reanalyse) void startAnalysis();
  };

  return (
    <section class="profile">
      <h2>
        <input class="name" value={p.name} aria-label="Profile name" onChange={(e) => void renameProfile(e.currentTarget.value)} />
      </h2>
      {ratings.length > 0 && (
        <p class="ratings">
          {ratings.map((r) => (
            <span class="chip static">
              {SITE_NAMES[r.site]} {r.speed} <strong>{r.rating}</strong>
            </span>
          ))}
          <span class="muted"> Latest rated game per site; ratings from different sites aren't comparable, so they're never combined.</span>
        </p>
      )}

      <h3>Accounts</h3>
      <ul class="accounts">
        {p.accounts.map((a) => (
          <AccountRow key={`${a.site}:${a.username}`} a={a} />
        ))}
      </ul>
      <button onClick={() => void syncAll()} disabled={syncStatus.value.running || !p.accounts.length}>
        {syncStatus.value.running ? 'Syncing…' : 'Sync new games'}
      </button>
      <h4>Link another account</h4>
      <LinkAccountForm />

      <h3>Analysis</h3>
      <div class="settings">
        <NumberSetting label="Mistake threshold" hint={`(centipawns; now ${pawns(s.thresholdCp)} pawns)`} value={s.thresholdCp} min={30} max={300} step={10} onChange={(n) => set({ thresholdCp: n }, true)} />
        <NumberSetting label="Moves to check" hint="(your first N moves of each game)" value={s.maxPly / 2} min={5} max={40} onChange={(n) => set({ maxPly: n * 2 }, true)} />
        <NumberSetting label="Engine depth" hint="(higher is slower; raising it re-analyses)" value={s.depth} min={8} max={24} onChange={(n) => set({ depth: n }, true)} />
        <NumberSetting label="Engine workers" hint={`(0 = automatic, ${autoWorkers()} here)`} value={s.workers} min={0} max={navigator.hardwareConcurrency || 8} onChange={(n) => set({ workers: n })} />
      </div>
      <h3>Drills</h3>
      <div class="settings">
        <NumberSetting label="New positions per day" value={s.newPerDay} min={0} max={200} onChange={(n) => set({ newPerDay: n })} />
        <NumberSetting label="Moves to play on" hint="(after a right answer)" value={s.lineLength} min={0} max={10} onChange={(n) => set({ lineLength: n })} />
        <NumberSetting label="Also accept moves within" hint="(centipawns of the best)" value={s.altToleranceCp} min={0} max={100} step={5} onChange={(n) => set({ altToleranceCp: n })} />
      </div>

      <h3>Data</h3>
      <p class="muted">
        Everything lives in this browser (IndexedDB). Export a copy now and then, so clearing browser data can't lose your games,
        analysis or review schedule.
      </p>
      <div class="actions">
        <button
          onClick={async () => {
            const { name, blob } = await exportProfile();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
          }}
        >
          Export profile
        </button>
        <ImportButton onDone={(m) => setMessage(m)} />
        <button
          class="danger"
          onClick={() => {
            if (confirm(`Delete the profile "${p.name}" and its review schedule from this browser?`)) void removeProfile();
          }}
        >
          Delete profile
        </button>
      </div>
      {message && <p>{message}</p>}
    </section>
  );
}

export function ImportButton({ onDone }: { onDone?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label class={busy ? 'button disabled' : 'button'}>
      {busy ? 'Importing…' : 'Import profile file'}
      <input
        type="file"
        accept=".json,application/json"
        hidden
        disabled={busy}
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const p = await importProfile(await file.text());
            onDone?.(`Imported "${p.name}".`);
          } catch (err) {
            onDone?.(`Couldn't import: ${(err as Error).message}`);
          }
          input.value = '';
          setBusy(false);
        }}
      />
    </label>
  );
}
