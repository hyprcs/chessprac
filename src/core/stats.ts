import type { GameRecord } from './types';

export interface OpeningScore {
  name: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** (wins + draws / 2) / games */
  score: number;
}

export function scoreByOpening(games: GameRecord[], level: 'family' | 'variation' = 'variation'): OpeningScore[] {
  const by = new Map<string, OpeningScore>();
  for (const g of games) {
    const name = g.opening?.[level] ?? 'Unclassified';
    const s = by.get(name) ?? { name, games: 0, wins: 0, draws: 0, losses: 0, score: 0 };
    s.games++;
    if (g.result === 'win') s.wins++;
    else if (g.result === 'draw') s.draws++;
    else s.losses++;
    by.set(name, s);
  }
  for (const s of by.values()) s.score = (s.wins + s.draws / 2) / s.games;
  return [...by.values()].sort((a, b) => b.games - a.games);
}
