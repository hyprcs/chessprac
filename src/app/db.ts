import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EvalEntry, GameAnalysis, GameRecord, Profile, Site } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/types';
import type { DrillCard } from '../core/srs';
import type { DrillAttempt, DrillSession } from '../core/drill-log';

interface Schema extends DBSchema {
  profiles: { key: string; value: Profile };
  /** Games belong to an account (site + username), so profiles sharing an account share its games. */
  games: { key: string; value: GameRecord; indexes: { account: [Site, string] } };
  /** Keyed by game id: an analysis depends only on the game and the engine settings. */
  analyses: { key: string; value: GameAnalysis };
  /** Engine evaluations by position key, shared by every game and profile. */
  evals: { key: string; value: EvalEntry & { key: string } };
  cards: { key: [string, string]; value: DrillCard; indexes: { profile: string } };
  /** Since version 2: every drill move, and the sessions they were made in. */
  attempts: { key: string; value: DrillAttempt; indexes: { profile: string } };
  sessions: { key: string; value: DrillSession; indexes: { profile: string } };
}

const VERSION = 2;

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbp ??= openDB<Schema>('chessprac', VERSION, {
    // Each step runs only for databases older than it, so existing data is kept.
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('profiles', { keyPath: 'id' });
        d.createObjectStore('games', { keyPath: 'id' }).createIndex('account', ['site', 'account']);
        d.createObjectStore('analyses', { keyPath: 'gameId' });
        d.createObjectStore('evals', { keyPath: 'key' });
        d.createObjectStore('cards', { keyPath: ['profileId', 'key'] }).createIndex('profile', 'profileId');
      }
      if (oldVersion < 2) {
        d.createObjectStore('attempts', { keyPath: 'id' }).createIndex('profile', 'profileId');
        d.createObjectStore('sessions', { keyPath: 'id' }).createIndex('profile', 'profileId');
      }
    },
    // Another tab is still on an older version and holds the upgrade up.
    blocked() {
      console.warn('chessprac: close other chessprac tabs so the database can upgrade');
    },
    // A newer chessprac opened in another tab: step aside so it can upgrade, and reload to pick up the new code.
    blocking() {
      void dbp?.then((d) => d.close());
      location.reload();
    },
  });
  return dbp;
}

export async function listProfiles(): Promise<Profile[]> {
  const ps = await (await db()).getAll('profiles');
  // Fill in settings added since the profile was saved.
  return ps.map((p) => ({ ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } }));
}

export const putProfile = async (p: Profile) => void (await (await db()).put('profiles', p));

const PROFILE_STORES = ['cards', 'attempts', 'sessions'] as const;

export async function deleteProfile(p: Profile, others: Profile[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(['profiles', ...PROFILE_STORES], 'readwrite');
  await tx.objectStore('profiles').delete(p.id);
  for (const name of PROFILE_STORES) {
    const store = tx.objectStore(name);
    for (const k of await store.index('profile').getAllKeys(p.id)) await store.delete(k);
  }
  await tx.done;
  for (const a of p.accounts) if (!others.some((o) => o.accounts.some((b) => b.site === a.site && b.username === a.username))) await deleteAccountGames(a.site, a.username);
}

export async function gamesFor(p: Profile): Promise<GameRecord[]> {
  const d = await db();
  const lists = await Promise.all(p.accounts.map((a) => d.getAllFromIndex('games', 'account', [a.site, a.username])));
  return lists.flat();
}

export async function putGames(games: GameRecord[]): Promise<void> {
  const tx = (await db()).transaction('games', 'readwrite');
  await Promise.all([...games.map((g) => tx.store.put(g)), tx.done]);
}

export async function deleteAccountGames(site: Site, username: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['games', 'analyses'], 'readwrite');
  const ids = await tx.objectStore('games').index('account').getAllKeys([site, username]);
  for (const id of ids) {
    await tx.objectStore('games').delete(id);
    await tx.objectStore('analyses').delete(id);
  }
  await tx.done;
}

export async function analysesFor(gameIds: string[]): Promise<Map<string, GameAnalysis>> {
  const tx = (await db()).transaction('analyses');
  const all = await Promise.all(gameIds.map((id) => tx.store.get(id)));
  await tx.done;
  return new Map(all.filter((a): a is GameAnalysis => !!a).map((a) => [a.gameId, a]));
}

export async function putAnalyses(list: GameAnalysis[]): Promise<void> {
  const tx = (await db()).transaction('analyses', 'readwrite');
  await Promise.all([...list.map((a) => tx.store.put(a)), tx.done]);
}

export async function allEvals(): Promise<Map<string, EvalEntry>> {
  const rows = await (await db()).getAll('evals');
  return new Map(rows.map(({ key, ...e }) => [key, e]));
}

export async function putEvals(entries: [string, EvalEntry][]): Promise<void> {
  const tx = (await db()).transaction('evals', 'readwrite');
  await Promise.all([...entries.map(([key, e]) => tx.store.put({ key, ...e })), tx.done]);
}

export async function cardsFor(profileId: string): Promise<Map<string, DrillCard>> {
  const list = await (await db()).getAllFromIndex('cards', 'profile', profileId);
  return new Map(list.map((c) => [c.key, c]));
}

export async function putCards(cards: DrillCard[]): Promise<void> {
  const tx = (await db()).transaction('cards', 'readwrite');
  await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
}

export const attemptsFor = async (profileId: string) => (await db()).getAllFromIndex('attempts', 'profile', profileId);
export const sessionsFor = async (profileId: string) => (await db()).getAllFromIndex('sessions', 'profile', profileId);

export async function putAttempts(list: DrillAttempt[]): Promise<void> {
  const tx = (await db()).transaction('attempts', 'readwrite');
  await Promise.all([...list.map((a) => tx.store.put(a)), tx.done]);
}

export async function putSessions(list: DrillSession[]): Promise<void> {
  const tx = (await db()).transaction('sessions', 'readwrite');
  await Promise.all([...list.map((s) => tx.store.put(s)), tx.done]);
}
