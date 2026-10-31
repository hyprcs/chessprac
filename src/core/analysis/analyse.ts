import type { EvalEntry, GameAnalysis, GameRecord, MoveEval } from '../types';
import { playUci, positionKey, replay, type Ply } from '../position';
import type { EvalJob } from './engine';

export type EvalLookup = (key: string) => EvalEntry | undefined;

/** Bump when analyseGame starts deriving something new; older analyses are then re-derived from the cached evals. */
export const ANALYSIS_VERSION = 1;

/** Lines searched after a flagged move: the punishment, and the runner-up to tell an only move from one of several. */
export const REFUTATION_LINES = 2;

/** My moves within the first `maxPly` plies. */
export function myPlies(game: GameRecord, maxPly: number): Ply[] {
  const mine = game.color === 'white' ? 0 : 1;
  return replay(game.moves, maxPly).filter((p) => p.ply % 2 === mine);
}

/** A cached evaluation good enough to use (terminal positions only ever reach depth 0). */
export const usable = (e: EvalEntry | undefined, depth: number): e is EvalEntry =>
  !!e && (e.depth >= depth || e.best === null);

/** A cached evaluation that already has the two-line search refutationJobs asks for. */
export const hasRefutation = (e: EvalEntry | undefined, depth: number): e is EvalEntry =>
  usable(e, depth) && e.second !== undefined;

/**
 * The entry to store for a fresh result. A refutation search of a position
 * that already has a usable score keeps that score and best move, adding only
 * the line, win/draw/loss and runner-up: an extra search must never shift the
 * scores of moves already judged. (Its runner-up score, from the two-line
 * search, can differ from `cp` by a few centipawns.)
 */
export function mergeEval(prev: EvalEntry | undefined, next: EvalEntry, depth: number): EvalEntry {
  if (next.second === undefined || !usable(prev, depth)) return next;
  return { ...next, cp: prev.cp, best: prev.best, depth: prev.depth };
}

const lichessEval = (game: GameRecord, ply: number): number | null =>
  ply < 0 ? null : (game.lichessEvals?.[ply] ?? null);

/**
 * Positions the engine must score for one game: before and after each of my
 * moves. Games Lichess already analysed only need the odd gap filled (e.g.
 * the starting position, which Lichess doesn't score).
 */
export function enginePositions(game: GameRecord, maxPly: number): EvalJob[] {
  const out: EvalJob[] = [];
  for (const p of myPlies(game, maxPly)) {
    if (lichessEval(game, p.ply - 1) === null) out.push({ key: positionKey(p.fenBefore), fen: p.fenBefore });
    if (lichessEval(game, p.ply) === null) out.push({ key: positionKey(p.fenAfter), fen: p.fenAfter });
  }
  return out;
}

/** Positions the engine still has to look at for these games, deduplicated, in game order. */
export function engineJobs(games: GameRecord[], maxPly: number, depth: number, lookup: EvalLookup): EvalJob[] {
  const jobs = new Map<string, EvalJob>();
  for (const game of games)
    for (const j of enginePositions(game, maxPly)) if (!jobs.has(j.key) && !usable(lookup(j.key), depth)) jobs.set(j.key, j);
  return [...jobs.values()];
}

/**
 * Scores every one of my moves in the opening phase of a game: how much worse
 * it was than the best move, from my side. Returns null if an evaluation is
 * still missing.
 */
export function analyseGame(game: GameRecord, maxPly: number, depth: number, lookup: EvalLookup): GameAnalysis | null {
  const sign = game.color === 'white' ? 1 : -1;
  const moves: MoveEval[] = [];
  for (const p of myPlies(game, maxPly)) {
    const key = positionKey(p.fenBefore);
    const engineBefore = lookup(key);
    const liBefore = lichessEval(game, p.ply - 1);
    const liAfter = lichessEval(game, p.ply);

    let before: number;
    let after: number;
    if (liBefore !== null) before = sign * liBefore;
    else if (usable(engineBefore, depth)) before = engineBefore.cp;
    else return null;
    if (liAfter !== null) after = sign * liAfter;
    else {
      const e = lookup(positionKey(p.fenAfter));
      if (!usable(e, depth)) return null;
      after = -e.cp; // the engine scores it for my opponent, who is to move
    }

    const best = game.lichessBest?.[p.ply] ?? engineBefore?.best ?? null;
    const loss = best === p.uci ? 0 : Math.max(0, before - after);
    moves.push({
      ply: p.ply,
      key,
      fen: p.fenBefore,
      san: p.san,
      uci: p.uci,
      before,
      after,
      loss,
      best,
      source: liBefore !== null && liAfter !== null ? 'lichess' : 'engine',
    });
  }
  return { gameId: game.id, depth, maxPly, version: ANALYSIS_VERSION, moves };
}

/** Flagged positions that still have no best move to drill (Lichess only names one for its own judgments). */
export function bestMoveJobs(analyses: GameAnalysis[], thresholdCp: number, lookup: EvalLookup): EvalJob[] {
  const jobs = new Map<string, EvalJob>();
  for (const a of analyses)
    for (const m of a.moves)
      if (m.loss > thresholdCp && !m.best && !lookup(m.key)?.best) jobs.set(m.key, { key: m.key, fen: m.fen });
  return [...jobs.values()];
}

/**
 * The positions right after my flagged moves, searched for two lines: the
 * opponent's best line shows how the move is punished (and is what tactic
 * tagging reads), and the runner-up shows whether that punishment was the
 * only good reply.
 */
export function refutationJobs(analyses: GameAnalysis[], thresholdCp: number, depth: number, lookup: EvalLookup): EvalJob[] {
  const jobs = new Map<string, EvalJob>();
  for (const a of analyses)
    for (const m of a.moves) {
      if (m.loss <= thresholdCp) continue;
      const fen = playUci(m.fen, m.uci);
      if (!fen) continue;
      const key = positionKey(fen);
      if (!jobs.has(key) && !hasRefutation(lookup(key), depth)) jobs.set(key, { key, fen, multiPv: REFUTATION_LINES });
    }
  return [...jobs.values()];
}
