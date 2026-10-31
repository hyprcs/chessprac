import type { Color, GameRecord } from './types';

export interface OpeningScore {
  name: string;
  color: Color;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** (wins + draws / 2) / games */
  score: number;
}

/** Score per opening and colour (a line played as White and as Black are different repertoires). */
export function scoreByOpening(games: GameRecord[], level: 'family' | 'variation' = 'variation'): OpeningScore[] {
  const by = new Map<string, OpeningScore>();
  for (const g of games) {
    const name = g.opening?.[level] ?? 'Unclassified';
    const k = `${name}|${g.color}`;
    const s = by.get(k) ?? { name, color: g.color, games: 0, wins: 0, draws: 0, losses: 0, score: 0 };
    s.games++;
    if (g.result === 'win') s.wins++;
    else if (g.result === 'draw') s.draws++;
    else s.losses++;
    by.set(k, s);
  }
  for (const s of by.values()) s.score = (s.wins + s.draws / 2) / s.games;
  return [...by.values()].sort((a, b) => b.games - a.games);
}
