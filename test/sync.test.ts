import { describe, expect, it, vi } from 'vitest';
import type { Account, SyncState } from '../src/core/types';
import { IMPORT_SCHEMA, syncAccount } from '../src/core/import/sync';

const seen: SyncState[] = [];
vi.mock('../src/core/import/chesscom', () => ({
  syncChesscom: async (_user: string, state: SyncState) => {
    seen.push(state);
    return { ...state, lastArchive: '2026/10', lastSyncAt: 1 };
  },
}));

describe('sync schema', () => {
  const acc = (sync: SyncState): Account => ({ site: 'chesscom', username: 'me', sync });

  it('fetches an account synced by an older importer again from its start date, once', async () => {
    const from = Date.UTC(2026, 1, 1);
    const once = await syncAccount(acc({ from, lastArchive: '2026/09', lastSyncAt: 5 }), { onGame: () => {} });
    expect(seen.at(-1)).toEqual({ from });
    expect(once.sync).toMatchObject({ from, lastArchive: '2026/10', schema: IMPORT_SCHEMA });

    await syncAccount(once, { onGame: () => {} });
    expect(seen.at(-1)).toMatchObject({ lastArchive: '2026/10', schema: IMPORT_SCHEMA });
  });
});
