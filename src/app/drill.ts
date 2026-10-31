import { Chess } from 'chess.js';
import type { EvalEntry } from '../core/types';
import { positionKey, uciToSan } from '../core/position';
import { usable } from '../core/analysis/analyse';
import { topReply } from '../core/replies';
import * as store from './db';
import { evals, getReplyIndex, settings } from './state';
import { drillEngine } from './engine';

export interface Judgement {
  kind: 'best' | 'good' | 'wrong';
  /** Centipawns, my side. */
  loss: number;
  before: number;
  after: number;
  best: string | null;
  bestSan: string | null;
}

/** Cached evaluation, or a fresh one from the drill engine (then cached). */
export async function evalOf(fen: string): Promise<EvalEntry> {
  const key = positionKey(fen);
  const depth = settings.value.depth;
  const have = evals.get(key);
  if (usable(have, depth)) return have;
  const e = await (await drillEngine()).evaluate(fen, depth);
  evals.set(key, e);
  void store.putEvals([[key, e]]);
  return e;
}

export function applyUci(chess: Chess, uci: string) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

/**
 * How good was `uci` here? The best move is right; anything within
 * `tolerance` centipawns of it is "good"; worse is wrong.
 */
export async function judge(fen: string, uci: string, knownBest: string | null, tolerance: number): Promise<Judgement> {
  const before = await evalOf(fen);
  const best = knownBest ?? before.best;
  const bestSan = best ? uciToSan(fen, best) : null;
  if (uci === best) return { kind: 'best', loss: 0, before: before.cp, after: before.cp, best, bestSan };
  const chess = new Chess(fen);
  applyUci(chess, uci);
  const after = -(await evalOf(chess.fen())).cp;
  const loss = Math.max(0, before.cp - after);
  return { kind: loss <= tolerance ? 'good' : 'wrong', loss, before: before.cp, after, best, bestSan };
}

export interface Reply {
  uci: string;
  san: string;
  /** Where it came from: what opponents chose against me, or the engine when no opponent ever reached it. */
  source: 'games' | 'engine';
  count?: number;
  total?: number;
}

export async function opponentReply(fen: string): Promise<Reply | null> {
  const chess = new Chess(fen);
  if (chess.isGameOver()) return null;
  const top = topReply(await getReplyIndex(), positionKey(fen));
  if (top) return { uci: top.uci, san: uciToSan(fen, top.uci)!, source: 'games', count: top.count, total: top.total };
  const e = await evalOf(fen);
  return e.best ? { uci: e.best, san: uciToSan(fen, e.best)!, source: 'engine' } : null;
}

export function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
