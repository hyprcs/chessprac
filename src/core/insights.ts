import type { Color, GameAnalysis, GameRecord, MoveEval, Speed } from './types';
import type { EvalLookup } from './analysis/analyse';
import { rankMistakes } from './mistakes';
import { classifyOpening } from './openings';
import { moveNumberLabel, playUci, positionKey } from './position';
import { ELO_PER_POINT, expectedScore, ratingExpectation } from './score';
import { estimatedSeconds, formatTimeControl } from './timecontrol';

/**
 * The one "key insight" about a player, and how it rotates.
 *
 * Every finding compares the player with something fair: the opponents in the
 * same games (rated about the same, so a peer baseline that needs no outside
 * data), or the player's own results from the same positions. Each is costed
 * in one currency, score lost per 100 games, so findings of different kinds
 * rank against each other, and only ones whose 95% range excludes zero count.
 */

export type InsightKind = 'clock' | 'phase' | 'hanging' | 'position' | 'opening' | 'tilt';

export type InsightChart =
  /** Points per 100 games won (+) or lost (−), per stretch of moves. */
  | { kind: 'diverging'; caption: string; rows: { label: string; value: number; highlight: boolean }[] }
  /** Two scores (0–1) side by side per row, with the games behind each. */
  | { kind: 'paired'; caption: string; series: [string, string]; rows: { label: string; a: number; b: number; na: number; nb: number }[] };

export interface Insight {
  /** The topic, stable across rotations ("phase:blitz", "position:<key>"), so a topic isn't repeated straight away. */
  id: string;
  kind: InsightKind;
  /** What it measured, so a later look can measure the same thing on newer games. */
  subject: { speed?: Speed; from?: number; to?: number; key?: string; variation?: string; color?: Color; move?: number; behind?: number };
  title: string;
  /** The evidence, a sentence or two each. */
  body: string[];
  advice: string;
  /** Score lost per 100 games against the comparison; higher is worse. */
  impact: number;
  /** The 95% range excludes zero (always true for a repeated position, which is a count, not an estimate). */
  sure: boolean;
  /** Games the evidence comes from. */
  games: number;
  /** The headline number, re-measured on later games to see whether things changed. */
  metric: Metric;
  chart?: InsightChart;
  position?: { fen: string; color: Color; wrong: string; best: string | null };
  /** Position keys the "Drill these" button opens, most costly first. */
  drill?: string[];
  /** How to drill them; practice when unset. */
  drillMode?: 'practice' | 'speed';
}

export interface Metric {
  label: string;
  value: number;
  unit: '' | '%';
  lowerIsBetter: boolean;
}

export interface InsightInput {
  games: GameRecord[];
  analyses: Map<string, GameAnalysis>;
  lookup: EvalLookup;
  thresholdCp: number;
}

/** A finding needs at least this many analysed games behind it. */
export const MIN_GAMES = 40;
/** A move that drops this much expected score (0–1) is a blunder. */
const BLUNDER = 0.15;
/** Games further apart than this are separate sittings. */
const SESSION_GAP = 30 * 60_000;
const WINDOWS: [number, number][] = [
  [1, 5],
  [6, 10],
  [11, 15],
  [16, 20],
];
/** Expected-score bands at the end of the analysed moves, for comparing like with like. */
const BANDS: { label: string; below: number }[] = [
  { label: 'Losing', below: 0.2 },
  { label: 'Worse', below: 0.4 },
  { label: 'Level', below: 0.6 },
  { label: 'Better', below: 0.8 },
  { label: 'Winning', below: Infinity },
];
const DRILL_MAX = 20;

// ---- Statistics ----

export interface Estimate {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

const variance = (xs: number[], mean: number) => xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1);

/** Mean with a normal-approximation 95% range. */
export function estimate(xs: number[]): Estimate {
  const n = xs.length;
  const mean = n ? xs.reduce((s, x) => s + x, 0) / n : 0;
  if (n < 2) return { mean, lo: -Infinity, hi: Infinity, n };
  const half = 1.96 * Math.sqrt(variance(xs, mean) / n);
  return { mean, lo: mean - half, hi: mean + half, n };
}

/** Difference of two means (Welch), with a 95% range. */
export function difference(a: number[], b: number[]): Estimate {
  const x = estimate(a);
  const y = estimate(b);
  const mean = x.mean - y.mean;
  const n = a.length + b.length;
  if (a.length < 2 || b.length < 2) return { mean, lo: -Infinity, hi: Infinity, n };
  // Each half-width is 1.96 standard errors, so this is 1.96 × √(se² + se²).
  const half = Math.hypot(x.hi - x.mean, y.hi - y.mean);
  return { mean, lo: mean - half, hi: mean + half, n };
}

/**
 * Difference of a − b compared within strata (bands of position), averaged
 * with weights by how many of `a` fall in each, so a group that simply
 * reached worse positions isn't blamed for it.
 */
export function stratifiedDifference(strata: { a: number[]; b: number[] }[]): Estimate {
  let w = 0;
  let sum = 0;
  let v = 0;
  let n = 0;
  for (const { a, b } of strata) {
    if (a.length < 5 || b.length < 5) continue;
    const ma = average(a);
    const mb = average(b);
    sum += a.length * (ma - mb);
    v += a.length ** 2 * (variance(a, ma) / a.length + variance(b, mb) / b.length);
    w += a.length;
    n += a.length + b.length;
  }
  if (!w) return { mean: 0, lo: -Infinity, hi: Infinity, n: 0 };
  const mean = sum / w;
  const half = (1.96 * Math.sqrt(v)) / w;
  return { mean, lo: mean - half, hi: mean + half, n };
}

const average = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const points = (g: GameRecord) => (g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0);
const moveNo = (ply: number) => Math.floor(ply / 2) + 1;

// ---- Wording ----

const one = (x: number) => (Math.abs(x) >= 10 ? Math.round(x).toString() : x.toFixed(1));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
const range = (e: Estimate, scale = 100) => `95% range ${one(e.lo * scale)} to ${one(e.hi * scale)}`;

/** "about 30 rating points" for a cost in score per 100 games. */
export function ratingWorth(per100: number): string {
  const r = (per100 / 100) * ELO_PER_POINT;
  return r < 8 ? 'a few rating points' : `about ${Math.round(r / 5) * 5} rating points`;
}

function scopeOf(games: GameRecord[], speed: Speed): string {
  const tcs = new Map<string, number>();
  for (const g of games) tcs.set(formatTimeControl(g.timeControl), (tcs.get(formatTimeControl(g.timeControl)) ?? 0) + 1);
  const [tc, n] = [...tcs].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return n >= games.length * 0.8 ? `${tc} games` : `${speed} games`;
}

// ---- Per-move rows: my moves and my opponent's, scored the same way ----

interface Row {
  ply: number;
  mine: boolean;
  /** Change in my expected score (0–1 scale) the move made: negative when it gave something away. */
  delta: number;
  /** Seconds spent on it, where clocks were recorded. */
  think: number | null;
  /** For my move: the move. For theirs: my next move, which starts from the position their move made. */
  eval: MoveEval;
}

const lost = (r: Row) => (r.mine ? Math.max(0, -r.delta) : Math.max(0, r.delta));

function thinkTime(g: GameRecord, ply: number): number | null {
  if (g.timeControl.kind !== 'live' || !g.clocks) return null;
  const now = g.clocks[ply];
  const before = ply >= 2 ? g.clocks[ply - 2] : g.timeControl.base;
  return now == null || before == null ? null : Math.max(0, before - now + g.timeControl.inc);
}

/**
 * My moves come straight from the analysis. An opponent's move sits between
 * two of mine, so its effect is the change from the position after my move to
 * the position before my next one. Both use the raw evaluations, signed, so
 * the changes over a stretch of moves add up exactly to how far the game
 * moved (`loss` would zero my side's small evaluation wobble but not theirs).
 */
function rowsOf(g: GameRecord, a: GameAnalysis): Row[] {
  const out: Row[] = [];
  const ms = a.moves;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    out.push({ ply: m.ply, mine: true, delta: expectedScore(m.after) - expectedScore(m.before), think: thinkTime(g, m.ply), eval: m });
    const next = ms[i + 1];
    if (next && next.ply === m.ply + 2)
      out.push({ ply: m.ply + 1, mine: false, delta: expectedScore(next.before) - expectedScore(m.after), think: thinkTime(g, m.ply + 1), eval: next });
  }
  return out;
}

interface Played {
  game: GameRecord;
  rows: Row[];
  /** My expected score after my last analysed move. */
  end: number;
  endMove: number;
}

function played(input: InsightInput, games = input.games): Played[] {
  const out: Played[] = [];
  for (const game of games) {
    if (game.timeControl.kind !== 'live') continue;
    const a = input.analyses.get(game.id);
    const last = a?.moves[a.moves.length - 1];
    if (a && last) out.push({ game, rows: rowsOf(game, a), end: expectedScore(last.after), endMove: moveNo(last.ply) });
  }
  return out;
}

function bySpeed(ps: Played[]): Map<Speed, Played[]> {
  const out = new Map<Speed, Played[]>();
  for (const p of ps) out.set(p.game.speed, [...(out.get(p.game.speed) ?? []), p]);
  return out;
}

/** Keys of my costliest mistakes among these rows, for a drill. */
function drillKeys(rows: Row[], thresholdCp: number): string[] {
  const cost = new Map<string, number>();
  for (const r of rows) if (r.mine && r.eval.loss > thresholdCp) cost.set(r.eval.key, (cost.get(r.eval.key) ?? 0) + lost(r));
  return [...cost].sort((a, b) => b[1] - a[1]).slice(0, DRILL_MAX).map(([k]) => k);
}

const inMoves = (ps: Played[], from: number, to: number) => ps.flatMap((p) => p.rows.filter((r) => moveNo(r.ply) >= from && moveNo(r.ply) <= to));

// ---- Game phase against opponents ----

/**
 * Per game, how far my expected score moved over moves from–to. Only move
 * numbers where both sides' moves are scored count, so neither side gets an
 * extra move in a stretch.
 */
function phaseNet(p: Played, from: number, to: number): number | null {
  const mine = new Map<number, number>();
  const theirs = new Map<number, number>();
  for (const r of p.rows) {
    const n = moveNo(r.ply);
    if (n >= from && n <= to) (r.mine ? mine : theirs).set(n, r.delta);
  }
  let net = 0;
  let any = false;
  for (const [n, d] of mine) {
    const t = theirs.get(n);
    if (t === undefined) continue;
    net += d + t;
    any = true;
  }
  return any ? net : null;
}

const netsOf = (ps: Played[], from: number, to: number) => ps.map((p) => phaseNet(p, from, to)).filter((x): x is number => x !== null);

function phaseInsights(ps: Played[], speed: Speed, thresholdCp: number): Insight[] {
  const scope = scopeOf(ps.map((p) => p.game), speed);
  const windows = WINDOWS.map(([from, to]) => ({ from, to, est: estimate(netsOf(ps, from, to)) })).filter((w) => w.est.n >= MIN_GAMES);
  if (!windows.length) return [];

  // Runs of consecutive stretches where I lose ground.
  const runs: { from: number; to: number }[] = [];
  for (const w of windows) {
    if (w.est.mean >= 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === w.from - 1) last.to = w.to;
    else runs.push({ from: w.from, to: w.to });
  }

  return runs.map((run) => {
    const est = estimate(netsOf(ps, run.from, run.to));
    const cost = -est.mean * 100;
    const before = windows.filter((w) => w.to < run.from);
    const gain = estimate(netsOf(ps, 1, run.from - 1));
    const ahead = before.length > 0 && gain.lo > 0;
    const late = run.from > 5;
    const body = [
      ahead
        ? `By move ${run.from - 1} of your ${scope} you're ahead of your opponents, by ${one(gain.mean * 100)} points per 100 games. Then in moves ${run.from}–${run.to} you give away ${one(cost)} (${range({ ...est, lo: -est.hi, hi: -est.lo })}).`
        : `In moves ${run.from}–${run.to} of your ${scope} you give away ${one(cost)} points per 100 games to your opponents (${range({ ...est, lo: -est.hi, hi: -est.lo })}).`,
      `Your opponents are rated about the same as you, so that's ground a player at your level holds. It's worth ${ratingWorth(cost)}.`,
    ];
    return {
      id: `phase:${speed}`,
      kind: 'phase' as const,
      subject: { speed, from: run.from, to: run.to },
      title: ahead ? `You win the opening, then give it back in moves ${run.from}–${run.to}` : late ? `Moves ${run.from}–${run.to} are where your games slip away` : 'Your games go wrong from the first moves',
      body,
      advice: late
        ? `Your openings aren't what's losing games; the positions just after them are. Drill your mistakes from moves ${run.from}–${run.to}, and in games, slow down once you're out of the moves you know.`
        : `Your first moves are costing you before the game gets going. Drill your mistakes from moves ${run.from}–${run.to} until the right moves come without thinking.`,
      impact: cost,
      sure: est.hi < 0,
      games: est.n,
      metric: { label: `Points per 100 games given away in moves ${run.from}–${run.to}`, value: cost, unit: '' as const, lowerIsBetter: true },
      chart: {
        kind: 'diverging' as const,
        caption: 'Points per 100 games you win (+) or lose (−) against your opponents, by move',
        rows: windows.map((w) => ({ label: `${w.from}–${w.to}`, value: w.est.mean * 100, highlight: w.from >= run.from && w.to <= run.to })),
      },
      drill: drillKeys(inMoves(ps, run.from, run.to), thresholdCp),
    };
  });
}

// ---- The clock, from the same positions ----

/** Seconds left after move n, mine minus my opponent's (both after their own nth move). */
function clockGap(g: GameRecord, n: number): number | null {
  const mine = 2 * (n - 1) + (g.color === 'white' ? 0 : 1);
  const theirs = 2 * (n - 1) + (g.color === 'white' ? 1 : 0);
  const a = g.clocks?.[mine];
  const b = g.clocks?.[theirs];
  return a == null || b == null ? null : a - b;
}

/** "Behind on the clock" means this share of the game's expected length, e.g. 27s in 3+0. */
const BEHIND_SHARE = 0.15;

interface ClockGame {
  p: Played;
  gap: number;
  behind: boolean;
}

function clockGames(ps: Played[], move: number, behind: number): ClockGame[] {
  const out: ClockGame[] = [];
  for (const p of ps) {
    if (p.endMove < move) continue;
    const gap = clockGap(p.game, move);
    if (gap !== null) out.push({ p, gap, behind: gap <= -behind });
  }
  return out;
}

function clockInsight(ps: Played[], speed: Speed, thresholdCp: number): Insight | null {
  const move = Math.min(20, Math.max(...ps.map((p) => p.endMove)));
  const est = ps.map((p) => estimatedSeconds(p.game.timeControl) ?? 0).sort((a, b) => a - b)[Math.floor(ps.length / 2)];
  const behind = Math.round(est * BEHIND_SHARE);
  const cg = clockGames(ps, move, behind);
  if (move < 10 || !behind || cg.length < MIN_GAMES) return null;
  const strata = BANDS.map((band, i) => {
    const inBand = cg.filter((c) => c.p.end < band.below && c.p.end >= (BANDS[i - 1]?.below ?? 0));
    return { label: band.label, a: inBand.filter((c) => c.behind).map((c) => points(c.p.game)), b: inBand.filter((c) => !c.behind).map((c) => points(c.p.game)) };
  });
  const diff = stratifiedDifference(strata);
  const share = cg.filter((c) => c.behind).length / cg.length;
  if (share < 0.05) return null;
  const cost = -diff.mean * share * 100;
  const scope = scopeOf(cg.map((c) => c.p.game), speed);
  const gap = estimate(cg.map((c) => c.gap));
  const anyBehind = cg.filter((c) => c.gap < 0).length / cg.length;
  const early = inMoves(ps, 1, 10).filter((r) => r.think !== null);
  const mine = average(early.filter((r) => r.mine).map((r) => r.think!));
  const theirs = average(early.filter((r) => !r.mine).map((r) => r.think!));
  const level = strata[2];
  return {
    id: `clock:${speed}`,
    kind: 'clock',
    subject: { speed, move, behind },
    title: 'Falling behind on the clock is costing you games',
    body: [
      `In your ${scope} you reach move ${move} behind on the clock in ${pct(anyBehind)} of games, by ${secs(Math.abs(gap.mean))} on average` +
        (mine > theirs * 1.1 ? `: in moves 1–10 you take ${secs(mine)} a move to your opponents' ${secs(theirs)}.` : '.'),
      `From the same position at move ${move}, being ${behind}s or more behind goes with ${one(-diff.mean * 100)} fewer points per 100 games (${range({ ...diff, lo: -diff.hi, hi: -diff.lo })})` +
        (level.a.length >= 5 && level.b.length >= 5 ? `. In level positions you score ${pct(average(level.a))} when behind and ${pct(average(level.b))} when not.` : '.'),
      // Same position, different clock is as close to cause as game records get, but it isn't proof, so the cost is put as a ceiling.
      `You're that far behind in ${pct(share)} of games. If the clock is the whole reason, that's up to ${one(cost)} points per 100 games, ${ratingWorth(cost)}.`,
    ],
    advice: `Play the moves you know at speed and keep your thinking for the positions after them. Speed-running your drill sets is exactly that practice; aim to reach move ${move} level on the clock.`,
    drillMode: 'speed',
    impact: cost,
    sure: diff.hi < 0,
    games: cg.length,
    metric: { label: `Games you reach move ${move} ${behind}s or more behind on the clock`, value: share * 100, unit: '%', lowerIsBetter: true },
    chart: {
      kind: 'paired',
      caption: `Your score by how the position stood at move ${move}`,
      series: [`${behind}s+ behind on the clock`, 'Otherwise'],
      rows: strata.filter((s) => s.a.length + s.b.length > 0).map((s) => ({ label: s.label, a: average(s.a), b: average(s.b), na: s.a.length, nb: s.b.length })),
    },
    drill: drillKeys(inMoves(ps, 1, 10), thresholdCp),
  };
}

// ---- Material left to a capture ----

/** The piece letter on a square of a FEN board, or null. */
export function pieceAt(fen: string, square: string): string | null {
  const file = square.charCodeAt(0) - 97;
  const row = fen.split(' ')[0].split('/')[8 - Number(square[1])];
  if (!row) return null;
  let f = 0;
  for (const ch of row) {
    if (ch >= '1' && ch <= '8') f += Number(ch);
    else if (f++ === file) return ch;
    if (f > file) return null;
  }
  return null;
}

const takesPiece = (fen: string, uci: string | null | undefined) => !!uci && /[nbrq]/i.test(pieceAt(fen, uci.slice(2, 4)) ?? '');

/** Was this blunder punished by capturing a piece (knight or bigger)? */
function droppedPiece(r: Row, g: GameRecord, lookup: EvalLookup): boolean {
  if (r.mine) {
    const after = playUci(r.eval.fen, r.eval.uci);
    if (!after) return false;
    return takesPiece(after, lookup(positionKey(after))?.best ?? g.lichessBest?.[r.ply + 1]);
  }
  // Their blunder: my best reply is from the position before my next move.
  const m = r.eval;
  return takesPiece(m.fen, m.best ?? lookup(m.key)?.best ?? (m.loss === 0 ? m.uci : null));
}

interface Drops {
  mine: number;
  theirs: number;
  /** My expected score lost to them minus theirs. */
  net: number;
  keys: { key: string; lost: number }[];
  blunders: number;
}

function dropsOf(p: Played, lookup: EvalLookup): Drops {
  const d: Drops = { mine: 0, theirs: 0, net: 0, keys: [], blunders: 0 };
  for (const r of p.rows) {
    const l = lost(r);
    if (l < BLUNDER) continue;
    if (r.mine) d.blunders++;
    if (!droppedPiece(r, p.game, lookup)) continue;
    if (r.mine) {
      d.mine++;
      d.net += l;
      d.keys.push({ key: r.eval.key, lost: l });
    } else {
      d.theirs++;
      d.net -= l;
    }
  }
  return d;
}

function hangingInsight(ps: Played[], speed: Speed, lookup: EvalLookup): Insight | null {
  if (ps.length < MIN_GAMES) return null;
  const scope = scopeOf(ps.map((p) => p.game), speed);
  const drops = ps.map((p) => dropsOf(p, lookup));
  const est = estimate(drops.map((d) => d.net));
  const mine = drops.reduce((s, d) => s + d.mine, 0);
  const theirs = drops.reduce((s, d) => s + d.theirs, 0);
  const blunders = drops.reduce((s, d) => s + d.blunders, 0);
  const per100 = (x: number) => (x / ps.length) * 100;
  const cost = est.mean * 100;
  const keys = drops.flatMap((d) => d.keys).sort((a, b) => b.lost - a.lost);
  return {
    id: `hanging:${speed}`,
    kind: 'hanging',
    subject: { speed },
    title: 'You leave pieces to be taken more often than your opponents do',
    body: [
      `In your ${scope}, one of your moves lets the opponent capture a piece and come out ahead ${one(per100(mine))} times per 100 games; your opponents do it ${one(per100(theirs))} times.`,
      `Those moves cost you ${one(cost)} more points per 100 games than theirs cost them (${range(est)}), worth ${ratingWorth(cost)}.` +
        (blunders ? ` They're ${pct(mine / blunders)} of your blunders in the first 20 moves.` : ''),
    ],
    advice: 'Before every move, a two-second check: after this, what can they capture? Then drill the positions where it happened.',
    impact: cost,
    sure: est.lo > 0,
    games: ps.length,
    metric: { label: 'Times per 100 games a move of yours drops a piece', value: per100(mine), unit: '', lowerIsBetter: true },
    drill: [...new Set(keys.map((k) => k.key))].slice(0, DRILL_MAX),
  };
}

// ---- One position gone wrong again and again ----

function positionInsights(input: InsightInput, ps: Played[]): Insight[] {
  const games = ps.map((p) => p.game);
  const groups = rankMistakes(games, input.analyses, input.thresholdCp, input.lookup);
  const out: Insight[] = [];
  for (const g of groups) {
    if (g.occurrences.length < 3 || g.occurrences.length < g.reached / 2 || !g.best) continue;
    const gave = g.occurrences.reduce((s, o) => s + Math.max(0, expectedScore(o.move.before) - expectedScore(o.move.after)), 0);
    const wrong = new Map<string, { n: number; uci: string }>();
    for (const o of g.occurrences) wrong.set(o.move.san, { n: (wrong.get(o.move.san)?.n ?? 0) + 1, uci: o.move.uci });
    const top = [...wrong].sort((a, b) => b[1].n - a[1].n);
    const label = moveNumberLabel(g.occurrences[0].move.ply);
    const opening = classifyOpening(g.occurrences[0].game.moves.slice(0, g.occurrences[0].move.ply));
    const cost = (gave / games.length) * 100;
    out.push({
      id: `position:${g.key}`,
      kind: 'position',
      subject: { key: g.key },
      title: `You've gone wrong in this ${opening ? `${opening.family} ` : ''}position ${g.occurrences.length} times`,
      body: [
        `You've reached it in ${g.reached} games and gone wrong in ${g.occurrences.length}: ${top.map(([san, w]) => `${label}${san}${w.n > 1 ? ` ×${w.n}` : ''}`).join(', ')}. The engine's move is ${label}${g.bestSan}.`,
        `Those mistakes gave away ${one(gave)} points in all, ${one(cost)} per 100 games.`,
      ],
      advice: `You keep meeting it and keep getting it wrong, so it's worth knowing cold. Drill it until ${label}${g.bestSan} comes without thinking.`,
      impact: cost,
      sure: true,
      games: g.reached,
      metric: { label: 'Times you go wrong, of the times you reach it', value: (g.occurrences.length / g.reached) * 100, unit: '%', lowerIsBetter: true },
      position: { fen: g.fen, color: g.color, wrong: top[0][1].uci, best: g.best },
      drill: [g.key],
    });
    if (out.length >= 3) break;
  }
  return out;
}

// ---- Openings against rating expectation ----

const rated = (g: GameRecord) => g.rated && g.myRating != null && g.oppRating != null;
const surplus = (g: GameRecord) => points(g) - ratingExpectation(g.myRating!, g.oppRating!);

function openingInsights(ps: Played[], thresholdCp: number): Insight[] {
  const all = ps.filter((p) => rated(p.game));
  const by = new Map<string, Played[]>();
  for (const p of all) {
    if (!p.game.opening) continue;
    const k = `${p.game.opening.variation}|${p.game.color}`;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const out: Insight[] = [];
  for (const [k, list] of by) {
    if (list.length < MIN_GAMES) continue;
    const [variation, color] = k.split('|') as [string, Color];
    const est = estimate(list.map((p) => surplus(p.game)));
    if (est.mean >= 0) continue;
    const share = list.length / all.length;
    const cost = -est.mean * share * 100;
    const score = average(list.map((p) => points(p.game)));
    const expected = average(list.map((p) => ratingExpectation(p.game.myRating!, p.game.oppRating!)));
    out.push({
      id: `opening:${variation}|${color}`,
      kind: 'opening',
      subject: { variation, color },
      title: `The ${variation} is costing you as ${color === 'white' ? 'White' : 'Black'}`,
      body: [
        `You've scored ${pct(score)} in ${list.length} rated games with it, where your rating and your opponents' predicted ${pct(expected)} (${range(est)} points per 100 games).`,
        `It's ${pct(share)} of your games, so it costs ${one(cost)} points per 100 games overall, worth ${ratingWorth(cost)}.`,
      ],
      advice: 'Drill the mistakes from these games. If it still lags after that, it may be worth switching to a line you score better with.',
      impact: cost,
      sure: est.hi < 0,
      games: list.length,
      metric: { label: `Points above expectation per 100 games in the ${variation}`, value: est.mean * 100, unit: '', lowerIsBetter: false },
      drill: drillKeys(list.flatMap((p) => p.rows), thresholdCp),
    });
  }
  return out;
}

// ---- Straight after a loss ----

/** Rated games played within a sitting, with the game before. */
function afterGames(ps: Played[]): { game: GameRecord; prev: GameRecord }[] {
  const gs = ps.map((p) => p.game).sort((a, b) => a.playedAt - b.playedAt);
  const out: { game: GameRecord; prev: GameRecord }[] = [];
  for (let i = 1; i < gs.length; i++) if (gs[i].playedAt - gs[i - 1].playedAt < SESSION_GAP && rated(gs[i])) out.push({ game: gs[i], prev: gs[i - 1] });
  return out;
}

function tiltInsight(ps: Played[], speed: Speed): Insight | null {
  const pairs = afterGames(ps);
  const afterLoss = pairs.filter((x) => x.prev.result === 'loss').map((x) => x.game);
  const otherwise = pairs.filter((x) => x.prev.result !== 'loss').map((x) => x.game);
  if (afterLoss.length < MIN_GAMES || otherwise.length < MIN_GAMES) return null;
  const est = difference(afterLoss.map(surplus), otherwise.map(surplus));
  const share = afterLoss.length / ps.length;
  const cost = -est.mean * share * 100;
  const scope = scopeOf(ps.map((p) => p.game), speed);
  const line = (gs: GameRecord[]) => `${pct(average(gs.map(points)))} against an expected ${pct(average(gs.map((g) => ratingExpectation(g.myRating!, g.oppRating!))))}`;
  return {
    id: `tilt:${speed}`,
    kind: 'tilt',
    subject: { speed },
    title: 'Your next game goes worse after a loss',
    body: [
      `In your ${scope}, when you start a game straight after losing one you score ${line(afterLoss)}. After a win or a draw you score ${line(otherwise)}.`,
      `The gap is ${one(-est.mean * 100)} points per 100 of those games (${range({ ...est, lo: -est.hi, hi: -est.lo })}), and ${pct(share)} of your games come straight after a loss, so it costs ${one(cost)} per 100 games overall.`,
    ],
    advice: "After a loss, stop for five minutes before the next game, or call it a day. The games you'd have played on tilt are the ones dragging your score down.",
    impact: cost,
    sure: est.hi < 0,
    games: afterLoss.length,
    metric: { label: 'Points above expectation per 100 games straight after a loss', value: estimate(afterLoss.map(surplus)).mean * 100, unit: '', lowerIsBetter: false },
  };
}

// ---- All of it ----

/** Every finding, sure or not, most costly first. */
export function findInsights(input: InsightInput): Insight[] {
  const ps = played(input);
  const out: Insight[] = [];
  for (const [speed, list] of bySpeed(ps)) {
    if (list.length < MIN_GAMES) continue;
    out.push(...phaseInsights(list, speed, input.thresholdCp));
    for (const x of [clockInsight(list, speed, input.thresholdCp), hangingInsight(list, speed, input.lookup), tiltInsight(list, speed)]) if (x) out.push(x);
  }
  out.push(...positionInsights(input, ps), ...openingInsights(ps, input.thresholdCp));
  return out.sort((a, b) => b.impact - a.impact);
}

/**
 * The insight's headline number measured again on other games (the ones
 * played since it was shown), or null when they're too few to say.
 */
export function remeasure(insight: Insight, input: InsightInput, games: GameRecord[]): { value: number; games: number } | null {
  const ps = played(input, games);
  const s = insight.subject;
  const ofSpeed = ps.filter((p) => p.game.speed === s.speed);
  const enough = 20;
  switch (insight.kind) {
    case 'phase': {
      const nets = netsOf(ofSpeed, s.from!, s.to!);
      return nets.length < enough ? null : { value: -average(nets) * 100, games: nets.length };
    }
    case 'clock': {
      const cg = clockGames(ofSpeed, s.move!, s.behind!);
      return cg.length < enough ? null : { value: (cg.filter((c) => c.behind).length / cg.length) * 100, games: cg.length };
    }
    case 'hanging': {
      if (ofSpeed.length < enough) return null;
      const mine = ofSpeed.reduce((n, p) => n + dropsOf(p, input.lookup).mine, 0);
      return { value: (mine / ofSpeed.length) * 100, games: ofSpeed.length };
    }
    case 'position': {
      let reached = 0;
      let wrong = 0;
      for (const p of ps)
        for (const r of p.rows)
          if (r.mine && r.eval.key === s.key) {
            reached++;
            if (r.eval.loss > input.thresholdCp) wrong++;
          }
      return reached ? { value: (wrong / reached) * 100, games: reached } : null;
    }
    case 'opening': {
      const list = ps.filter((p) => rated(p.game) && p.game.opening?.variation === s.variation && p.game.color === s.color);
      return list.length < enough ? null : { value: average(list.map((p) => surplus(p.game))) * 100, games: list.length };
    }
    case 'tilt': {
      const after = afterGames(ofSpeed).filter((x) => x.prev.result === 'loss').map((x) => x.game);
      return after.length < enough ? null : { value: average(after.map(surplus)) * 100, games: after.length };
    }
  }
}

// ---- Which insight to show, and when to change it ----

/** A new insight after this long, or this many games played since, whichever comes first. */
export const ROTATE_DAYS = 30;
export const ROTATE_GAMES = 150;
const DAY = 86_400_000;

export interface FollowUp {
  title: string;
  metric: Metric;
  /** The re-measured value on the games since, or null when there were too few. */
  now: number | null;
  games: number;
}

export interface ShownInsight {
  insight: Insight;
  shownAt: number;
  /** When it was read ("Got it"); until then it's flagged as new. */
  seenAt?: number;
  /** How the insight before this one held up in the games since it was shown. */
  followUp?: FollowUp;
}

export interface InsightState {
  current: ShownInsight | null;
  /** Topics shown, newest first. */
  history: { id: string; shownAt: number }[];
}

/** The strongest sure finding, skipping topics shown in the last two rotations while there's anything else. */
export function pickInsight(candidates: Insight[], recent: string[]): Insight | null {
  const sure = candidates.filter((c) => c.sure && c.impact > 0).sort((a, b) => b.impact - a.impact);
  return sure.find((c) => !recent.includes(c.id)) ?? sure[0] ?? null;
}

export const gamesSince = (games: GameRecord[], since: number) => games.filter((g) => g.playedAt > since);

export function rotationDue(shown: ShownInsight, now: number, games: GameRecord[]): boolean {
  return now - shown.shownAt >= ROTATE_DAYS * DAY || gamesSince(games, shown.shownAt).length >= ROTATE_GAMES;
}

/** When the next insight comes: days left and games left, whichever runs out first. */
export function nextRotation(shown: ShownInsight, now: number, games: GameRecord[]): { days: number; games: number } {
  return {
    days: Math.max(0, Math.ceil((shown.shownAt + ROTATE_DAYS * DAY - now) / DAY)),
    games: Math.max(0, ROTATE_GAMES - gamesSince(games, shown.shownAt).length),
  };
}

/**
 * The state after a check: a first insight once there's one worth showing, a
 * new one when the current one is due, otherwise null (nothing changes). An
 * insight stays exactly as it was shown until it rotates, so its numbers don't
 * shift under the player every time a game comes in.
 */
export function nextInsightState(state: InsightState | undefined, input: InsightInput, now: number): InsightState | null {
  const current = state?.current ?? null;
  if (current && !rotationDue(current, now, input.games)) return null;
  const history = state?.history ?? [];
  const pick = pickInsight(findInsights(input), history.slice(0, 2).map((h) => h.id));
  if (!pick) return null;
  let followUp: FollowUp | undefined;
  if (current) {
    const since = gamesSince(input.games, current.shownAt);
    const m = remeasure(current.insight, input, since);
    followUp = { title: current.insight.title, metric: current.insight.metric, now: m?.value ?? null, games: m?.games ?? since.length };
  }
  return {
    current: { insight: pick, shownAt: now, followUp },
    history: [{ id: pick.id, shownAt: now }, ...history].slice(0, 12),
  };
}
