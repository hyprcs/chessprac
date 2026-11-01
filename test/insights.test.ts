import { describe, expect, it } from 'vitest';
import type { GameAnalysis, GameRecord, MoveEval, Result } from '../src/core/types';
import {
  ROTATE_DAYS,
  ROTATE_GAMES,
  findInsights,
  nextInsightState,
  pickInsight,
  pieceAt,
  rotationDue,
  stratifiedDifference,
  type Insight,
  type InsightInput,
} from '../src/core/insights';
import { START_FEN } from '../src/core/position';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/**
 * A 3+0 game as White, analysed to move 20. `cp(n)` is my evaluation after
 * my nth move (the opponent's replies keep it), and the clocks run evenly
 * except that I can be `behind` seconds down by move 20.
 */
function game(i: number, opts: { result: Result; behind?: number; cp?: (move: number) => number; at?: number }): [GameRecord, GameAnalysis] {
  const cp = opts.cp ?? (() => 0);
  const clocks: number[] = [];
  for (let ply = 0; ply < 44; ply++) {
    const n = Math.floor(ply / 2) + 1;
    const mine = ply % 2 === 0;
    clocks.push(180 - n * 4 - (mine ? Math.min(n, 20) * ((opts.behind ?? 0) / 20) : 0));
  }
  const g: GameRecord = {
    id: `chesscom:${i}`, site: 'chesscom', siteId: String(i), url: `https://x/${i}`, playedAt: opts.at ?? T0 + i * 3_600_000,
    account: 'me', color: 'white', opponent: 'o', timeControl: { kind: 'live', base: 180, inc: 0 }, speed: 'blitz',
    siteSpeed: 'blitz', rated: true, myRating: 1500, oppRating: 1500, result: opts.result, opening: null, siteOpening: null,
    moves: [], clocks,
  };
  const moves: MoveEval[] = [];
  for (let n = 1; n <= 20; n++) {
    const before = n === 1 ? 0 : cp(n - 1);
    const after = cp(n);
    moves.push({ ply: 2 * (n - 1), key: `k${i}-${n}`, fen: START_FEN, san: 'a3', uci: 'a2a3', before, after, loss: Math.max(0, before - after), best: 'a2a3', source: 'engine' });
  }
  return [g, { gameId: g.id, depth: 16, maxPly: 40, version: 1, moves }];
}

function input(pairs: [GameRecord, GameAnalysis][]): InsightInput {
  return { games: pairs.map((p) => p[0]), analyses: new Map(pairs.map(([g, a]) => [g.id, a])), lookup: () => undefined, thresholdCp: 80 };
}

/** 120 games: half reach move 20 40s behind on the clock and mostly lose; the rest mostly win. */
function clockGames(): [GameRecord, GameAnalysis][] {
  return Array.from({ length: 120 }, (_, i) => {
    const behind = i % 2 === 0;
    const result: Result = behind ? (i % 6 === 0 ? 'win' : 'loss') : i % 6 === 1 ? 'loss' : 'win';
    return game(i, { result, behind: behind ? 40 : 0 });
  });
}

describe('insights', () => {
  it('finds the clock costing games from the same positions', () => {
    const found = findInsights(input(clockGames()));
    const clock = found.find((x) => x.kind === 'clock')!;
    expect(clock.sure).toBe(true);
    expect(clock.impact).toBeGreaterThan(0);
    expect(clock.metric.value).toBeCloseTo(50);
    expect(clock.drillMode).toBe('speed');
    // Even evaluations, no blunders, no sittings: nothing else is sure.
    expect(found.filter((x) => x.sure).map((x) => x.kind)).toEqual(['clock']);
  });

  it('finds the stretch of moves where the player loses ground to equal opponents', () => {
    // Each of my moves 11–15 drops 30 centipawns; every game is otherwise even.
    const cp = (n: number) => -30 * Math.max(0, Math.min(n, 15) - 10);
    const pairs = Array.from({ length: 60 }, (_, i) => game(i, { result: 'draw', cp }));
    const phase = findInsights(input(pairs)).find((x) => x.kind === 'phase')!;
    expect(phase.subject).toMatchObject({ from: 11, to: 15 });
    expect(phase.sure).toBe(true);
    expect(phase.chart?.kind).toBe('diverging');
  });

  it('compares like with like when one group reached worse positions', () => {
    // Group a scores the same as b within each band, but sits mostly in the worse band.
    const est = stratifiedDifference([
      { a: [0, 0, 0, 0, 1, 0, 0, 0, 0, 1], b: [0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { a: [1, 1, 1, 1, 0], b: [1, 1, 1, 1, 0, 1, 1, 1, 1, 0] },
    ]);
    expect(est.mean).toBeCloseTo(0);
  });

  it('reads pieces off a FEN board', () => {
    const fen = 'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -';
    expect(pieceAt(fen, 'c3')).toBe('N');
    expect(pieceAt(fen, 'd5')).toBe('p');
    expect(pieceAt(fen, 'e5')).toBeNull();
    expect(pieceAt(fen, 'h8')).toBe('r');
  });
});

describe('insight rotation', () => {
  const sure = (id: string, impact: number) => ({ id, impact, sure: true }) as Insight;

  it('skips topics shown recently while there is anything else', () => {
    expect(pickInsight([sure('a', 5), sure('b', 3)], ['a'])?.id).toBe('b');
    expect(pickInsight([sure('a', 5)], ['a'])?.id).toBe('a');
    expect(pickInsight([{ ...sure('a', 5), sure: false }], [])).toBeNull();
  });

  it('pins the first insight, keeps it a month, then rotates with a follow-up', () => {
    const data = input(clockGames());
    const now = T0 + 200 * DAY;
    const first = nextInsightState(undefined, data, now)!;
    expect(first.current?.insight.kind).toBe('clock');
    expect(first.current?.followUp).toBeUndefined();

    expect(nextInsightState(first, data, now + 10 * DAY)).toBeNull();

    const later = nextInsightState(first, data, now + (ROTATE_DAYS + 1) * DAY)!;
    // Still the only sure finding, so it comes back, with how it went since (no games since, so no verdict).
    expect(later.current?.insight.id).toBe(first.current?.insight.id);
    expect(later.current?.followUp).toMatchObject({ now: null, games: 0 });
    expect(later.history).toHaveLength(2);
  });

  it('rotates early once enough games have been played since', () => {
    const data = input(clockGames());
    const shown = { insight: sure('a', 1), shownAt: T0 + 200 * DAY };
    const after = Array.from({ length: ROTATE_GAMES }, (_, i) => game(1000 + i, { result: 'win', at: shown.shownAt + (i + 1) * 60_000 })[0]);
    expect(rotationDue(shown, shown.shownAt + DAY, data.games)).toBe(false);
    expect(rotationDue(shown, shown.shownAt + DAY, [...data.games, ...after])).toBe(true);
  });
});
