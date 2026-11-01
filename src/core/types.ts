import type { InsightState } from './insights';

export type Site = 'chesscom' | 'lichess';
export type Color = 'white' | 'black';
export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';
export type Result = 'win' | 'loss' | 'draw';

export type TimeControl =
  | { kind: 'live'; base: number; inc: number } // seconds
  | { kind: 'daily'; secondsPerMove: number };

/** One game, normalised so chess.com and Lichess games look identical. */
export interface GameRecord {
  /** `${site}:${siteId}` — the dedupe key. */
  id: string;
  site: Site;
  siteId: string;
  url: string;
  /** When the game finished, ms since epoch. */
  playedAt: number;
  /** Which of the profile's accounts played it (lower-cased). */
  account: string;
  color: Color;
  opponent: string;
  timeControl: TimeControl;
  /** Our own bucket from base + 40 × increment, not the site's label. */
  speed: Speed;
  /** The site's own label ("blitz", "daily"…), kept to show where our bucket disagrees. */
  siteSpeed: string;
  rated: boolean;
  /** Ratings are per-site and must never be averaged or charted across sites. */
  myRating: number | null;
  oppRating: number | null;
  result: Result;
  /** Opening classified from the moves with the Lichess opening book, same for both sites. */
  opening: Opening | null;
  /** The label the site itself gave, kept for reference only. */
  siteOpening: string | null;
  /** SAN moves from the standard starting position. */
  moves: string[];
  /** Lichess server analysis, if it exists: White-POV centipawns after each ply. */
  lichessEvals?: (number | null)[];
  /** Lichess's suggested better move (UCI) for a ply, where it gave one. */
  lichessBest?: (string | null)[];
  /** Seconds left on the mover's clock after each ply, where the site recorded it. */
  clocks?: (number | null)[];
  /** The site's own accuracy score (chess.com CAPS or Lichess accuracy), when it computed one. Not comparable across sites. */
  accuracy?: { mine: number | null; opp: number | null };
}

export interface Opening {
  eco: string;
  /** Full name, e.g. "Caro-Kann Defense: Advance Variation, Botvinnik-Carls Defense". */
  name: string;
  family: string;
  /** "Caro-Kann Defense: Advance Variation" — the level we group scores at. */
  variation: string;
}

export interface Account {
  site: Site;
  username: string;
  sync: SyncState;
}

export interface SyncState {
  /** First import only: take games from this time on (ms). Unset means all history. */
  from?: number;
  /** chess.com: last monthly archive fully or partly fetched, "YYYY/MM". */
  lastArchive?: string;
  /** Lichess: createdAt of the newest game imported, ms. */
  lastCreatedAt?: number;
  lastSyncAt?: number;
  /** IMPORT_SCHEMA the stored games were fetched with; older ones are fetched again once to fill in new fields. */
  schema?: number;
}

export interface Settings {
  /** Flag a move when it loses more than this many centipawns versus the best move. */
  thresholdCp: number;
  /** Only look at my moves within this many plies from the start (40 = first 20 moves). */
  maxPly: number;
  depth: number;
  /** Background engine workers; 0 means pick from the CPU count. */
  workers: number;
  /** New positions the recall queue introduces per day. */
  newPerDay: number;
  /** After a right answer, how many more of my moves the drill plays on. */
  lineLength: number;
  /** In a drill, a move this close to the best one also counts as right. */
  altToleranceCp: number;
}

export const DEFAULT_SETTINGS: Settings = {
  thresholdCp: 80,
  maxPly: 40,
  depth: 16,
  workers: 0,
  newPerDay: 10,
  lineLength: 3,
  altToleranceCp: 30,
};

export interface Profile {
  id: string;
  name: string;
  accounts: Account[];
  settings: Settings;
  createdAt: number;
  /** The key insight being shown, and the topics shown before it. */
  insights?: InsightState;
}

/** An engine evaluation of a position, side-to-move POV, clamped to ±MATE_CP. */
export interface EvalEntry {
  cp: number;
  best: string | null;
  depth: number;
  /**
   * The engine's main line (UCI). Missing on evaluations saved before lines were kept. A later refutation
   * search adds its line here but keeps `cp` and `best`, so in a near-tie the line can start with another move.
   */
  pv?: string[];
  /** Win/draw/loss chances per mille, side to move. */
  wdl?: [number, number, number];
  /**
   * The runner-up move from a two-line (MultiPV) search, so an "only good move" can be told apart.
   * Null when there was no second legal move; missing when only one line was searched.
   */
  second?: { cp: number; move: string } | null;
}

/** One of my moves, scored. */
export interface MoveEval {
  ply: number;
  /** FEN without move counters, the key for matching positions across games and sites. */
  key: string;
  fen: string;
  san: string;
  uci: string;
  /** My POV, centipawns, before (= best move) and after my move. */
  before: number;
  after: number;
  loss: number;
  best: string | null;
  source: 'engine' | 'lichess';
}

export interface GameAnalysis {
  gameId: string;
  depth: number;
  maxPly: number;
  /** ANALYSIS_VERSION it was computed with; missing means 1. A newer version re-derives it from the cached evals. */
  version?: number;
  moves: MoveEval[];
}
