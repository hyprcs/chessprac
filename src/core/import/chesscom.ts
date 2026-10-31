import type { GameRecord, Result } from '../types';
import { parseChesscomTimeControl, speedOf } from '../timecontrol';
import { positionKey, replay, START_FEN } from '../position';
import { classifyOpening } from '../openings';
import { getWithBackoff } from './http';
import { pgnHeaders, pgnMoves } from './pgn';
import type { Importer, SkipReason } from './common';

const API = 'https://api.chess.com/pub/player';

interface CcPlayer {
  username: string;
  rating?: number;
  result: string;
}

export interface CcGame {
  url: string;
  pgn?: string;
  time_control: string;
  time_class: string;
  end_time: number;
  rated?: boolean;
  rules: string;
  initial_setup?: string;
  eco?: string;
  white: CcPlayer;
  black: CcPlayer;
}

/** "https://api.chess.com/pub/player/x/games/2026/09" -> "2026/09" */
const archiveMonth = (url: string) => url.split('/games/')[1];

const monthOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Syncs one chess.com account. Fetches the archive list, then each monthly
 * archive from the last one we synced (re-fetching it, since it may have
 * grown) or from the month of `since` on a first import.
 */
export const syncChesscom: Importer = async (username, state, cb) => {
  const user = username.toLowerCase();
  const res = await getWithBackoff(`${API}/${encodeURIComponent(user)}/games/archives`, 'application/json', cb, 10_000);
  if (res.status === 404) throw new Error(`chess.com has no player called "${username}"`);
  if (!res.ok) throw new Error(`chess.com archives: HTTP ${res.status}`);
  const archives: string[] = (await res.json()).archives ?? [];

  const from = state.lastArchive ?? (cb.since ? monthOf(cb.since) : '0000/00');
  const todo = archives.filter((a) => archiveMonth(a) >= from);
  let last = state.lastArchive;

  for (const [i, url] of todo.entries()) {
    const month = archiveMonth(url);
    cb.onProgress?.(`chess.com ${month} (${i + 1}/${todo.length})`);
    const r = await getWithBackoff(url, 'application/json', cb, 10_000);
    if (!r.ok) throw new Error(`chess.com ${month}: HTTP ${r.status}`);
    const games: CcGame[] = (await r.json()).games ?? [];
    for (const g of games) {
      if (!state.lastArchive && cb.since && g.end_time * 1000 < cb.since) continue;
      const out = normaliseChesscom(g, user);
      if (typeof out === 'string') cb.onSkip?.(out, g.url);
      else await cb.onGame(out);
    }
    last = month;
  }
  return { ...state, lastArchive: last, lastSyncAt: Date.now() };
};

function resultFor(me: CcPlayer, opp: CcPlayer): Result {
  if (me.result === 'win') return 'win';
  if (opp.result === 'win') return 'loss';
  return 'draw';
}

/** "https://www.chess.com/openings/Caro-Kann-Defense-Advance-Variation-3...c5" -> "Caro Kann Defense Advance Variation 3...c5" */
function siteOpeningLabel(ecoUrl: string | undefined): string | null {
  if (!ecoUrl) return null;
  const slug = decodeURIComponent(ecoUrl.split('/openings/')[1] ?? '');
  return slug ? slug.replace(/-/g, ' ') : null;
}

export function normaliseChesscom(g: CcGame, account: string): GameRecord | SkipReason {
  if (g.rules !== 'chess') return 'variant';
  if (g.initial_setup && positionKey(g.initial_setup) !== positionKey(START_FEN)) return 'custom position';
  if (!g.pgn) return 'no moves';
  const headers = pgnHeaders(g.pgn);
  if (headers.SetUp === '1' && headers.FEN && positionKey(headers.FEN) !== positionKey(START_FEN)) return 'custom position';
  const tc = parseChesscomTimeControl(g.time_control);
  if (!tc) return 'unreadable';

  let moves: string[];
  try {
    moves = replay(pgnMoves(g.pgn)).map((p) => p.san);
  } catch {
    return 'unreadable';
  }
  if (moves.length === 0) return 'no moves';

  const isWhite = g.white.username.toLowerCase() === account;
  const me = isWhite ? g.white : g.black;
  const opp = isWhite ? g.black : g.white;
  // URL path is ".../game/live/123" or ".../game/daily/123"; the live and daily id spaces are separate.
  const siteId = g.url.split('/game/')[1] ?? g.url;
  return {
    id: `chesscom:${siteId}`,
    site: 'chesscom',
    siteId,
    url: g.url,
    playedAt: g.end_time * 1000,
    account,
    color: isWhite ? 'white' : 'black',
    opponent: opp.username,
    timeControl: tc,
    speed: speedOf(tc),
    siteSpeed: g.time_class,
    rated: g.rated ?? false,
    myRating: me.rating ?? null,
    oppRating: opp.rating ?? null,
    result: resultFor(me, opp),
    opening: classifyOpening(moves),
    siteOpening: siteOpeningLabel(headers.ECOUrl ?? g.eco),
    moves,
  };
}
