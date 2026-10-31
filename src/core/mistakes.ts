import type { Color, GameAnalysis, GameRecord, MoveEval, Site, Speed } from './types';
import { MATE_CP } from './score';
import { uciToSan } from './position';
import type { EvalLookup } from './analysis/analyse';

export interface Filters {
  sites?: Site[];
  colors?: Color[];
  speeds?: Speed[];
}

export function applyFilters(games: GameRecord[], f: Filters): GameRecord[] {
  return games.filter(
    (g) =>
      (!f.sites?.length || f.sites.includes(g.site)) &&
      (!f.colors?.length || f.colors.includes(g.color)) &&
      (!f.speeds?.length || f.speeds.includes(g.speed)),
  );
}

export interface Occurrence {
  game: GameRecord;
  move: MoveEval;
}

/** One position where I've gone wrong, with every time it happened. */
export interface MistakeGroup {
  key: string;
  fen: string;
  color: Color;
  occurrences: Occurrence[];
  /** Times I had this position on move, mistake or not. */
  reached: number;
  /** The moves I played here, mistakes or not, and how often. */
  played: Map<string, number>;
  best: string | null;
  bestSan: string | null;
  avgLoss: number;
  /** Frequency × cost: occurrences × average loss (each loss capped at MATE_CP). */
  score: number;
  sites: Site[];
}

export function rankMistakes(
  games: GameRecord[],
  analyses: Map<string, GameAnalysis>,
  thresholdCp: number,
  lookup: EvalLookup,
): MistakeGroup[] {
  const groups = new Map<string, MistakeGroup>();
  const visits = new Map<string, { reached: number; played: Map<string, number> }>();

  for (const game of games) {
    const a = analyses.get(game.id);
    if (!a) continue;
    for (const move of a.moves) {
      const v = visits.get(move.key) ?? { reached: 0, played: new Map() };
      v.reached++;
      v.played.set(move.san, (v.played.get(move.san) ?? 0) + 1);
      visits.set(move.key, v);
      if (move.loss <= thresholdCp) continue;
      let g = groups.get(move.key);
      if (!g) {
        g = {
          key: move.key,
          fen: move.fen,
          color: game.color,
          occurrences: [],
          reached: 0,
          played: new Map(),
          best: null,
          bestSan: null,
          avgLoss: 0,
          score: 0,
          sites: [],
        };
        groups.set(move.key, g);
      }
      g.occurrences.push({ game, move });
    }
  }

  for (const g of groups.values()) {
    const v = visits.get(g.key)!;
    g.reached = v.reached;
    g.played = v.played;
    const losses = g.occurrences.map((o) => Math.min(o.move.loss, MATE_CP));
    g.score = losses.reduce((s, l) => s + l, 0);
    g.avgLoss = g.score / losses.length;
    g.sites = [...new Set(g.occurrences.map((o) => o.game.site))];
    // Prefer our own engine's choice so the same position always drills the same move.
    g.best = lookup(g.key)?.best ?? g.occurrences.find((o) => o.move.best)?.move.best ?? null;
    g.bestSan = g.best ? uciToSan(g.fen, g.best) : null;
    g.occurrences.sort((x, y) => y.game.playedAt - x.game.playedAt);
  }

  return [...groups.values()].sort((a, b) => b.score - a.score);
}
