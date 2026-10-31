import type { GameRecord, TimeControl } from '../types';
import { speedOf } from '../timecontrol';
import { replay } from '../position';
import { classifyOpening } from '../openings';
import { clampCp, mateToCp } from '../score';
import { getWithBackoff, readLines } from './http';
import type { Importer, SkipReason } from './common';

const API = 'https://lichess.org/api/games/user';

interface LiPlayer {
  user?: { name: string; id: string };
  aiLevel?: number;
  rating?: number;
}

interface LiAnalysisEntry {
  eval?: number;
  mate?: number;
  best?: string;
}

export interface LiGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LiPlayer; black: LiPlayer };
  winner?: 'white' | 'black';
  opening?: { eco: string; name: string };
  moves?: string;
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
  initialFen?: string;
  analysis?: LiAnalysisEntry[];
}

/** Statuses for games that never really happened. */
const UNPLAYED = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);

/**
 * Syncs one Lichess account with a single streamed NDJSON request (Lichess
 * wants one request at a time). Oldest first, so `lastCreatedAt` only moves
 * forward and an interrupted sync resumes where it stopped.
 */
export const syncLichess: Importer = async (username, state, cb) => {
  const user = username.toLowerCase();
  const since = state.lastCreatedAt != null ? state.lastCreatedAt + 1 : cb.since;
  const params = new URLSearchParams({
    moves: 'true',
    pgnInJson: 'false',
    opening: 'true',
    evals: 'true',
    clocks: 'false',
    finished: 'true',
    sort: 'dateAsc',
  });
  if (since) params.set('since', String(since));
  cb.onProgress?.('Lichess: requesting games');
  const res = await getWithBackoff(`${API}/${encodeURIComponent(user)}?${params}`, 'application/x-ndjson', cb);
  if (res.status === 404) throw new Error(`Lichess has no player called "${username}" (or the request was refused)`);
  if (!res.ok) throw new Error(`Lichess: HTTP ${res.status}`);

  let lastCreatedAt = state.lastCreatedAt;
  let n = 0;
  for await (const line of readLines(res)) {
    const g: LiGame = JSON.parse(line);
    const out = normaliseLichess(g, user);
    if (typeof out === 'string') cb.onSkip?.(out, `https://lichess.org/${g.id}`);
    else await cb.onGame(out);
    lastCreatedAt = Math.max(lastCreatedAt ?? 0, g.createdAt);
    if (++n % 50 === 0) cb.onProgress?.(`Lichess: ${n} games`);
  }
  return { ...state, lastCreatedAt, lastSyncAt: Date.now() };
};

function timeControlOf(g: LiGame): TimeControl {
  if (g.clock) return { kind: 'live', base: g.clock.initial, inc: g.clock.increment };
  return { kind: 'daily', secondsPerMove: (g.daysPerTurn ?? 0) * 86400 };
}

const playerName = (p: LiPlayer) => p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');

export function normaliseLichess(g: LiGame, account: string): GameRecord | SkipReason {
  if (g.variant === 'fromPosition' || g.initialFen) return 'custom position';
  if (g.variant !== 'standard') return 'variant';
  if (UNPLAYED.has(g.status)) return 'aborted';
  if (!g.moves) return 'no moves';

  let moves: string[];
  try {
    moves = replay(g.moves.split(' ')).map((p) => p.san);
  } catch {
    return 'unreadable';
  }

  const color = g.players.white.user?.id === account ? 'white' : 'black';
  const me = g.players[color];
  const opp = g.players[color === 'white' ? 'black' : 'white'];
  const tc = timeControlOf(g);
  const game: GameRecord = {
    id: `lichess:${g.id}`,
    site: 'lichess',
    siteId: g.id,
    url: `https://lichess.org/${g.id}${color === 'black' ? '/black' : ''}`,
    playedAt: g.lastMoveAt,
    account,
    color,
    opponent: playerName(opp),
    timeControl: tc,
    speed: speedOf(tc),
    siteSpeed: g.speed,
    rated: g.rated,
    myRating: me.rating ?? null,
    oppRating: opp.rating ?? null,
    result: !g.winner ? 'draw' : g.winner === color ? 'win' : 'loss',
    opening: classifyOpening(moves),
    siteOpening: g.opening?.name ?? null,
    moves,
  };
  if (g.analysis?.length) {
    // analysis[i] is the position after ply i, White's point of view.
    game.lichessEvals = g.analysis.map((a) =>
      a.eval != null ? clampCp(a.eval) : a.mate != null ? mateToCp(a.mate) : null,
    );
    game.lichessBest = g.analysis.map((a) => a.best ?? null);
  }
  return game;
}
