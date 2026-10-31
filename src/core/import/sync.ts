import type { Account, Site } from '../types';
import type { ImportCallbacks, Importer } from './common';
import { syncChesscom } from './chesscom';
import { syncLichess } from './lichess';

const IMPORTERS: Record<Site, Importer> = { chesscom: syncChesscom, lichess: syncLichess };

export const SITE_NAMES: Record<Site, string> = { chesscom: 'chess.com', lichess: 'Lichess' };

/** Pulls new games for one linked account; returns the account with its sync state moved on. */
export async function syncAccount(account: Account, cb: ImportCallbacks): Promise<Account> {
  const sync = await IMPORTERS[account.site](account.username, account.sync, cb);
  return { ...account, sync };
}
