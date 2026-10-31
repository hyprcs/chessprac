import type { Speed, TimeControl } from './types';

/**
 * Upper bounds (exclusive) on estimated game length, base + 40 × increment in
 * seconds. Same bands for both sites so a 5+5 counts the same wherever it was played.
 */
export const SPEED_BANDS: { speed: Speed; below: number }[] = [
  { speed: 'bullet', below: 180 },
  { speed: 'blitz', below: 480 },
  { speed: 'rapid', below: 1500 },
  { speed: 'classical', below: Infinity },
];

export function estimatedSeconds(tc: TimeControl): number | null {
  return tc.kind === 'live' ? tc.base + 40 * tc.inc : null;
}

export function speedOf(tc: TimeControl): Speed {
  const est = estimatedSeconds(tc);
  if (est === null) return 'correspondence';
  return SPEED_BANDS.find((b) => est < b.below)!.speed;
}

/** chess.com "180", "180+2", daily "1/86400", or "-" for an untimed daily game. */
export function parseChesscomTimeControl(s: string): TimeControl | null {
  if (s === '-') return { kind: 'daily', secondsPerMove: 0 };
  const daily = /^1\/(\d+)$/.exec(s);
  if (daily) return { kind: 'daily', secondsPerMove: Number(daily[1]) };
  const live = /^(\d+)(?:\+(\d+))?$/.exec(s);
  if (live) return { kind: 'live', base: Number(live[1]), inc: Number(live[2] ?? 0) };
  return null;
}

export function formatTimeControl(tc: TimeControl): string {
  if (tc.kind === 'daily') return tc.secondsPerMove ? `${Math.round(tc.secondsPerMove / 86400)}d/move` : 'untimed';
  const base = tc.base % 60 === 0 ? String(tc.base / 60) : (tc.base / 60).toFixed(1).replace(/\.0$/, '');
  return `${base}+${tc.inc}`;
}
