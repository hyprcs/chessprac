import { batch, computed, signal } from '@preact/signals';
import type { EvalEntry, GameAnalysis, GameRecord, Profile, Settings, Site } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import { applyFilters, rankMistakes, type Filters } from '../core/mistakes';
import { syncAccount, SITE_NAMES } from '../core/import/sync';
import { findAccount } from '../core/import/accounts';
import { addGameReplies, type ReplyIndex } from '../core/replies';
import { PROFILE_FORMAT, PROFILE_VERSION, parseProfileFile, type ProfileFile } from '../core/profile-file';
import { reviveDrillCard, type DrillCard } from '../core/srs';
import type { DrillAttempt, DrillSession } from '../core/drill-log';
import type { InsightState } from '../core/insights';
import * as store from './db';

export const profiles = signal<Profile[]>([]);
export const currentId = signal<string | null>(null);
export const profile = computed(() => profiles.value.find((p) => p.id === currentId.value) ?? null);
export const settings = computed<Settings>(() => profile.value?.settings ?? DEFAULT_SETTINGS);

export const games = signal<GameRecord[]>([]);
export const analyses = signal<Map<string, GameAnalysis>>(new Map());
/** Engine evaluations by position key. A plain map for speed; bump evalsVersion after changing it. */
export const evals = new Map<string, EvalEntry>();
export const evalsVersion = signal(0);
export const lookup = (key: string) => evals.get(key);
export const cards = signal<Map<string, DrillCard>>(new Map());
export const loading = signal(true);

// ---- Per-viewer conveniences in localStorage (may be unavailable) ----

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

export const filters = signal<Filters>(readLocal<Filters>('chessprac.filters', {}));
export function setFilters(f: Filters) {
  filters.value = f;
  writeLocal('chessprac.filters', f);
}

export const filteredGames = computed(() => applyFilters(games.value, filters.value));
export const ranked = computed(() => {
  void evalsVersion.value; // best moves can arrive after the analysis
  return rankMistakes(filteredGames.value, analyses.value, settings.value.thresholdCp, lookup);
});

// ---- Loading ----

export async function init(): Promise<void> {
  const [ps, ev] = await Promise.all([store.listProfiles(), store.allEvals()]);
  for (const [k, e] of ev) evals.set(k, e);
  profiles.value = ps;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('chessprac.profile');
  } catch {
    /* ignore */
  }
  currentId.value = ps.find((p) => p.id === saved)?.id ?? ps[0]?.id ?? null;
  if (currentId.value) await loadProfileData();
  loading.value = false;
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}

async function loadProfileData(): Promise<void> {
  const p = profile.value;
  if (!p) {
    batch(() => {
      games.value = [];
      analyses.value = new Map();
      cards.value = new Map();
    });
    return;
  }
  const gs = await store.gamesFor(p);
  const [an, cs] = await Promise.all([store.analysesFor(gs.map((g) => g.id)), store.cardsFor(p.id)]);
  batch(() => {
    games.value = gs.sort((a, b) => b.playedAt - a.playedAt);
    analyses.value = an;
    cards.value = cs;
  });
  replyIndex.value = null;
}

export async function selectProfile(id: string | null): Promise<void> {
  currentId.value = id;
  if (id) writeLocal('chessprac.profile', id);
  await loadProfileData();
  onProfileLoaded.forEach((f) => f());
}

/** Hooks run after a profile's data loads (the analysis runner starts itself here). */
export const onProfileLoaded: (() => void)[] = [];

async function saveProfile(p: Profile): Promise<void> {
  await store.putProfile(p);
  profiles.value = profiles.value.some((x) => x.id === p.id)
    ? profiles.value.map((x) => (x.id === p.id ? p : x))
    : [...profiles.value, p];
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));

export async function createProfile(name: string): Promise<Profile> {
  const p: Profile = { id: newId(), name: name.trim() || 'Me', accounts: [], settings: { ...DEFAULT_SETTINGS }, createdAt: Date.now() };
  await saveProfile(p);
  await selectProfile(p.id);
  return p;
}

export async function renameProfile(name: string): Promise<void> {
  const p = profile.value;
  if (p && name.trim()) await saveProfile({ ...p, name: name.trim() });
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const p = profile.value;
  if (p) await saveProfile({ ...p, settings: { ...p.settings, ...patch } });
}

export async function saveInsights(insights: InsightState): Promise<void> {
  const p = profile.value;
  if (p) await saveProfile({ ...p, insights });
}

export async function removeProfile(): Promise<void> {
  const p = profile.value;
  if (!p) return;
  const others = profiles.value.filter((x) => x.id !== p.id);
  await store.deleteProfile(p, others);
  profiles.value = others;
  await selectProfile(others[0]?.id ?? null);
}

// ---- Accounts and syncing ----

export const syncStatus = signal<{ running: boolean; message: string; error: string | null }>({
  running: false,
  message: '',
  error: null,
});

/** Checks the player exists, links them to the current profile and imports their games. */
export async function linkAccount(site: Site, username: string, from: number | undefined): Promise<void> {
  const p = profile.value;
  if (!p) return;
  const found = await findAccount(site, username);
  if (!found) throw new Error(`${SITE_NAMES[site]} has no player called "${username.trim()}"`);
  const name = found.toLowerCase();
  if (p.accounts.some((a) => a.site === site && a.username === name)) throw new Error(`${found} is already linked`);
  await saveProfile({ ...p, accounts: [...p.accounts, { site, username: name, sync: { from } }] });
  await syncAll();
}

export async function unlinkAccount(site: Site, username: string): Promise<void> {
  const p = profile.value;
  if (!p) return;
  await saveProfile({ ...p, accounts: p.accounts.filter((a) => !(a.site === site && a.username === username)) });
  const stillUsed = profiles.value.some((o) => o.accounts.some((a) => a.site === site && a.username === username));
  if (!stillUsed) await store.deleteAccountGames(site, username);
  await loadProfileData();
}

/** Re-import an account from a different start date. Known games are kept; nothing is duplicated. */
export async function changeImportWindow(site: Site, username: string, from: number | undefined): Promise<void> {
  const p = profile.value;
  if (!p) return;
  await saveProfile({
    ...p,
    accounts: p.accounts.map((a) => (a.site === site && a.username === username ? { ...a, sync: { from } } : a)),
  });
  await syncAll();
}

export async function syncAll(): Promise<void> {
  const start = profile.value;
  if (!start || syncStatus.value.running) return;
  syncStatus.value = { running: true, message: 'Starting…', error: null };
  try {
    // One account at a time: Lichess asks for one request at a time, and chess.com likes it serial too.
    for (const acc of start.accounts) {
      const label = `${SITE_NAMES[acc.site]} ${acc.username}`;
      const buffer: GameRecord[] = [];
      let n = 0;
      const flush = () => store.putGames(buffer.splice(0));
      const updated = await syncAccount(acc, {
        since: acc.sync.from,
        onGame: async (g) => {
          buffer.push(g);
          n++;
          if (buffer.length >= 100) await flush();
        },
        onProgress: (m) => (syncStatus.value = { ...syncStatus.value, message: `${m} · ${n} games` }),
        onWait: (ms, why) =>
          (syncStatus.value = { ...syncStatus.value, message: `${label}: ${why}, waiting ${Math.round(ms / 1000)}s` }),
      });
      await flush();
      const latest = profiles.value.find((x) => x.id === start.id);
      if (latest)
        await saveProfile({
          ...latest,
          accounts: latest.accounts.map((a) => (a.site === acc.site && a.username === acc.username ? updated : a)),
        });
    }
    syncStatus.value = { running: false, message: `Synced ${new Date().toLocaleTimeString()}`, error: null };
  } catch (e) {
    syncStatus.value = { running: false, message: '', error: (e as Error).message };
  }
  if (currentId.value === start.id) {
    await loadProfileData();
    onProfileLoaded.forEach((f) => f());
  }
}

// ---- Opponent replies, for drills ----

export const replyIndex = signal<ReplyIndex | null>(null);
let building: Promise<ReplyIndex> | null = null;

/** Built lazily, a few games at a time so the page stays responsive. */
export function getReplyIndex(): Promise<ReplyIndex> {
  if (replyIndex.value) return Promise.resolve(replyIndex.value);
  const forGames = games.value;
  building ??= (async () => {
    const index: ReplyIndex = new Map();
    for (let i = 0; i < forGames.length; i++) {
      addGameReplies(index, forGames[i]);
      if (i % 40 === 39) await new Promise((r) => setTimeout(r));
    }
    if (games.value === forGames) replyIndex.value = index;
    building = null;
    return index;
  })();
  return building;
}

// ---- Cards ----

export async function saveCard(c: DrillCard): Promise<void> {
  await store.putCards([c]);
  cards.value = new Map(cards.value).set(c.key, c);
}

// ---- Drill log: written as it happens; a failed write must never interrupt a drill ----

export const logAttempt = (a: DrillAttempt) => store.putAttempts([a]).catch((e) => console.error('chessprac: drill attempt not saved', e));
export const logSession = (s: DrillSession) => store.putSessions([s]).catch((e) => console.error('chessprac: drill session not saved', e));

// ---- Export / import ----

export async function exportProfile(): Promise<{ name: string; blob: Blob }> {
  const p = profile.value!;
  const file: ProfileFile = {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: Date.now(),
    profile: p,
    games: games.value,
    analyses: [...analyses.value.values()],
    evals: Object.fromEntries(evals),
    cards: [...cards.value.values()],
    attempts: await store.attemptsFor(p.id),
    sessions: await store.sessionsFor(p.id),
  };
  const name = `chessprac-${p.name.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  return { name, blob: new Blob([JSON.stringify(file)], { type: 'application/json' }) };
}

/** Adds the file's profile (replacing one with the same id) and everything in it. */
export async function importProfile(text: string): Promise<Profile> {
  const file = parseProfileFile(text);
  const p: Profile = { ...file.profile, settings: { ...DEFAULT_SETTINGS, ...file.profile.settings } };
  await store.putGames(file.games);
  await store.putAnalyses(file.analyses);
  // Keep whichever evaluation of a position is deeper.
  const better = Object.entries(file.evals).filter(([k, e]) => !evals.has(k) || evals.get(k)!.depth < e.depth);
  for (let i = 0; i < better.length; i += 5000) await store.putEvals(better.slice(i, i + 5000));
  for (const [k, e] of better) evals.set(k, e);
  await store.putCards((file.cards as DrillCard[]).map((c) => reviveDrillCard({ ...c, profileId: p.id })));
  await store.putAttempts(file.attempts.map((a) => ({ ...a, profileId: p.id })));
  await store.putSessions(file.sessions.map((s) => ({ ...s, profileId: p.id })));
  await saveProfile(p);
  evalsVersion.value++;
  await selectProfile(p.id);
  return p;
}
