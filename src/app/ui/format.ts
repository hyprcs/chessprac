import type { GameRecord, Site, Speed } from '../../core/types';
import { SITE_NAMES } from '../../core/import/sync';
import { formatTimeControl } from '../../core/timecontrol';

export { SITE_NAMES };

export const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
export const SITES: Site[] = ['chesscom', 'lichess'];

/** Centipawns as signed pawns: +0.35, −2.10. */
export const signedPawns = (cp: number) => `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${Math.abs(cp / 100).toFixed(2)}`;
export const pawns = (cp: number) => (cp / 100).toFixed(2);

export const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const gameLabel = (g: GameRecord) => `${day(g.playedAt)} · ${SITE_NAMES[g.site]} · ${formatTimeControl(g.timeControl)} vs ${g.opponent}`;

export const percent = (x: number) => `${Math.round(x * 100)}%`;

export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Latest rating per site and speed. Ratings from different sites are never combined. */
export function latestRatings(games: GameRecord[]): { site: Site; speed: Speed; rating: number }[] {
  const seen = new Map<string, { site: Site; speed: Speed; rating: number; at: number }>();
  for (const g of games) {
    if (g.myRating == null || !g.rated) continue;
    const k = `${g.site}|${g.speed}`;
    if (!seen.has(k) || seen.get(k)!.at < g.playedAt) seen.set(k, { site: g.site, speed: g.speed, rating: g.myRating, at: g.playedAt });
  }
  return [...seen.values()].sort((a, b) => a.site.localeCompare(b.site) || SPEEDS.indexOf(a.speed) - SPEEDS.indexOf(b.speed));
}
