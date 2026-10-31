import type { Account, Site } from '../types';
import type { ImportCallbacks, Importer } from './common';
import { syncChesscom } from './chesscom';
import { syncLichess } from './lichess';

const IMPORTERS: Record<Site, Importer> = { chesscom: syncChesscom, lichess: syncLichess };

export const SITE_NAMES: Record<Site, string> = { chesscom: 'chess.com', lichess: 'Lichess' };

/** Bump when the importers start keeping something new. 2: clocks and the sites' accuracy scores. */
export const IMPORT_SCHEMA = 2;

/**
 * Pulls new games for one linked account; returns the account with its sync
 * state moved on. An account last synced by an older importer is fetched
 * again from its start date, once: games are stored by id, so the refetched
 * copies replace the old ones (gaining the new fields) and nothing doubles.
 */
export async function syncAccount(account: Account, cb: ImportCallbacks): Promise<Account> {
  const state = account.sync.schema === IMPORT_SCHEMA ? account.sync : { from: account.sync.from };
  const sync = await IMPORTERS[account.site](account.username, state, cb);
  return { ...account, sync: { ...sync, schema: IMPORT_SCHEMA } };
}
