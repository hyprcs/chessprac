import type { SetKind } from './drill-set';

export type DrillMode = 'recall' | 'speed' | 'practice';

/**
 * One move tried in a drilled position, in any mode. Kept in full (cards only
 * keep their last few results) so speed-run cycles, answer times and FSRS
 * grades can be studied and fitted later.
 */
export interface DrillAttempt {
  id: string;
  profileId: string;
  sessionId: string;
  /** Position key of the drilled position. */
  key: string;
  mode: DrillMode;
  /** When the move was made, ms since epoch. */
  at: number;
  /** From the position appearing to the move being made. */
  ms: number;
  uci: string;
  kind: 'best' | 'good' | 'wrong';
  /** Centipawns lost versus the best move, my side. */
  loss: number;
  /** The first try at this position in the session; only first tries are graded. */
  firstTry: boolean;
  /** The FSRS grade given (ts-fsrs Rating), on graded recall tries. */
  rating?: number;
}

/** One run through a set of positions. Its attempts carry its id. */
export interface DrillSession {
  id: string;
  profileId: string;
  mode: DrillMode;
  /** Which positions: a named set, the misses of the previous run, or ones picked from the mistakes list. */
  set: SetKind | 'misses' | 'picked';
  /** Positions in the session when it started. */
  size: number;
  shuffled: boolean;
  /** Whether the line was played on after a right answer. */
  playOn: boolean;
  startedAt: number;
  /** Null until it reaches its summary; stays null if it was closed part-way. */
  finishedAt: number | null;
  /** Ended with "End" before the last position. */
  endedEarly: boolean;
}
