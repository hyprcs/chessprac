import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { pgnHeaders, pgnMoves } from '../src/core/import/pgn';
import { positionKey, replay, formatLine } from '../src/core/position';
import { speedOf, parseChesscomTimeControl } from '../src/core/timecontrol';
import { classifyOpening } from '../src/core/openings';
import { normaliseChesscom, type CcGame } from '../src/core/import/chesscom';
import { normaliseLichess, type LiGame } from '../src/core/import/lichess';
import { analyseGame, engineJobs } from '../src/core/analysis/analyse';
import { Engine, type UciChannel } from '../src/core/analysis/engine';
import { rankMistakes } from '../src/core/mistakes';
import type { EvalEntry, GameRecord } from '../src/core/types';

const keyAfter = (sans: string[]) => {
  const c = new Chess();
  sans.forEach((s) => c.move(s));
  return positionKey(c.fen());
};

describe('pgn', () => {
  const pgn = `[Event "Live Chess"]
[SetUp "0"]
[ECOUrl "https://www.chess.com/openings/Caro-Kann-Defense-Advance-Variation"]

1. e4 {[%clk 0:02:59.9]} 1... c6 {[%clk 0:02:59]} 2. d4 $1 (2. Nc3 d5 (2... e5)) 2... d5 3. e5 1-0`;
  it('reads mainline SAN and headers', () => {
    expect(pgnMoves(pgn)).toEqual(['e4', 'c6', 'd4', 'd5', 'e5']);
    expect(pgnHeaders(pgn).ECOUrl).toContain('Caro-Kann');
  });
});

describe('positions', () => {
  it('matches transpositions and ignores move counters', () => {
    expect(keyAfter(['Nf3', 'd5', 'd4'])).toBe(keyAfter(['d4', 'd5', 'Nf3']));
  });
  it('ignores an en passant square nobody can use', () => {
    // After 1.e4 the ep square e3 is unusable; the key must equal the same position reached otherwise.
    expect(keyAfter(['e4'])).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
  });
  it('formats lines from either side', () => {
    expect(formatLine(['e4', 'c6', 'd4'])).toBe('1.e4 c6 2.d4');
    expect(formatLine(['c5', 'Nf3'], 5)).toBe('3...c5 4.Nf3');
  });
});

describe('speed buckets (base + 40 x increment)', () => {
  const s = (tc: string) => speedOf(parseChesscomTimeControl(tc)!);
  it('buckets by estimated duration, not site labels', () => {
    expect(s('120+1')).toBe('bullet');
    expect(s('180')).toBe('blitz');
    expect(s('180+2')).toBe('blitz');
    expect(s('300+5')).toBe('rapid'); // chess.com calls 5+5 blitz
    expect(s('600')).toBe('rapid');
    expect(s('1800')).toBe('classical');
    expect(s('1/86400')).toBe('correspondence');
    expect(s('-')).toBe('correspondence');
  });
});

describe('openings', () => {
  it('uses one naming for both sites, with familiar aliases', () => {
    expect(classifyOpening(['e4', 'c6', 'd4', 'd5', 'f3'])?.variation).toBe('Caro-Kann Defense: Fantasy (Maróczy) Variation');
    const adv = classifyOpening(['e4', 'c6', 'd4', 'd5', 'e5', 'c5', 'Nf3']);
    expect(adv?.name).toBe('Caro-Kann Defense: Advance Variation, Botvinnik-Carls Defense');
    expect(adv?.variation).toBe('Caro-Kann Defense: Advance Variation');
  });
});

const ccBase: CcGame = {
  url: 'https://www.chess.com/game/live/123',
  pgn: '[Event "x"]\n\n1. e4 c6 2. d4 d5 3. e5 0-1',
  time_control: '180',
  time_class: 'blitz',
  end_time: 1_790_000_000,
  rated: true,
  rules: 'chess',
  initial_setup: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  white: { username: 'Opp', rating: 1300, result: 'resigned' },
  black: { username: 'Hypriva', rating: 1250, result: 'win' },
};

describe('chess.com normalising', () => {
  it('builds a game record from my side', () => {
    const g = normaliseChesscom(ccBase, 'hypriva') as GameRecord;
    expect(g.id).toBe('chesscom:live/123');
    expect(g.color).toBe('black');
    expect(g.result).toBe('win');
    expect(g.myRating).toBe(1250);
    expect(g.speed).toBe('blitz');
    expect(g.moves).toEqual(['e4', 'c6', 'd4', 'd5', 'e5']);
  });
  it('skips variants and custom starting positions', () => {
    expect(normaliseChesscom({ ...ccBase, rules: 'chess960' }, 'hypriva')).toBe('variant');
    expect(normaliseChesscom({ ...ccBase, initial_setup: '4k3/8/8/8/8/8/8/4K2R w K - 0 1' }, 'hypriva')).toBe('custom position');
  });
});

const liBase: LiGame = {
  id: 'abcd1234',
  rated: true,
  variant: 'standard',
  speed: 'blitz',
  createdAt: 1,
  lastMoveAt: 2,
  status: 'resign',
  players: { white: { user: { name: 'Hypriva', id: 'hypriva' }, rating: 1500 }, black: { user: { name: 'x', id: 'x' }, rating: 1450 } },
  winner: 'black',
  moves: 'e4 e5 Nf3',
  clock: { initial: 300, increment: 5 },
  analysis: [{ eval: 30 }, { eval: 25 }, { mate: -2, best: 'g1f3' }],
};

describe('Lichess normalising', () => {
  it('maps evals and buckets 5+5 as rapid even though Lichess says blitz', () => {
    const g = normaliseLichess(liBase, 'hypriva') as GameRecord;
    expect(g.color).toBe('white');
    expect(g.result).toBe('loss');
    expect(g.speed).toBe('rapid');
    expect(g.siteSpeed).toBe('blitz');
    expect(g.lichessEvals).toEqual([30, 25, -1000]);
    expect(g.lichessBest).toEqual([null, null, 'g1f3']);
    expect(g.url).toBe('https://lichess.org/abcd1234');
  });
  it('skips variants, custom positions and aborted games', () => {
    expect(normaliseLichess({ ...liBase, variant: 'chess960' }, 'hypriva')).toBe('variant');
    expect(normaliseLichess({ ...liBase, variant: 'fromPosition' }, 'hypriva')).toBe('custom position');
    expect(normaliseLichess({ ...liBase, status: 'aborted' }, 'hypriva')).toBe('aborted');
  });
});

function game(moves: string[], color: 'white' | 'black', site: 'chesscom' | 'lichess' = 'chesscom', id = 'g1'): GameRecord {
  return {
    id: `${site}:${id}`, site, siteId: id, url: `https://x/${id}`, playedAt: 0, account: 'me', color, opponent: 'o',
    timeControl: { kind: 'live', base: 180, inc: 0 }, speed: 'blitz', siteSpeed: 'blitz', rated: true,
    myRating: null, oppRating: null, result: 'loss', opening: null, siteOpening: null, moves,
  };
}

describe('analysis', () => {
  it('scores losses from my side using side-to-move evals', () => {
    const g = game(['e4', 'c6', 'd4', 'c5'], 'black');
    const plies = replay(g.moves);
    const evals = new Map<string, EvalEntry>([
      [positionKey(plies[1].fenBefore), { cp: -30, best: 'c7c6', depth: 16 }], // Black to move before c6
      [positionKey(plies[1].fenAfter), { cp: 60, best: 'd2d4', depth: 16 }], // White to move after c6
      [positionKey(plies[3].fenBefore), { cp: -60, best: 'd7d5', depth: 16 }],
      [positionKey(plies[3].fenAfter), { cp: 180, best: 'd4c5', depth: 16 }],
    ]);
    const a = analyseGame(g, 40, 16, (k) => evals.get(k))!;
    expect(a.moves.map((m) => [m.san, m.loss])).toEqual([['c6', 0], ['c5', 120]]);
  });

  it('returns null until every position is evaluated, and asks only for what is missing', () => {
    const g = game(['e4', 'e5'], 'white');
    expect(analyseGame(g, 40, 16, () => undefined)).toBeNull();
    expect(engineJobs([g, g], 40, 16, () => undefined)).toHaveLength(2);
  });

  it('groups the same position across sites and ranks by count x loss', () => {
    const a = game(['e4', 'c6', 'd4', 'c5'], 'black', 'chesscom', 'a');
    const b = game(['d4', 'c6', 'e4', 'c5'], 'black', 'lichess', 'b'); // transposes
    const fake = (cp: number) => ({ cp, best: 'd7d5', depth: 16 });
    const analyses = new Map(
      [a, b].map((g) => [g.id, { gameId: g.id, depth: 16, maxPly: 40, moves: [
        { ply: 3, key: keyAfter(['e4', 'c6', 'd4']), fen: replay(g.moves)[3].fenBefore, san: 'c5', uci: 'c6c5', before: -50, after: -200, loss: 150, best: 'd7d5', source: 'engine' as const },
      ] }]),
    );
    const [top] = rankMistakes([a, b], analyses, 80, () => fake(-50));
    expect(top.occurrences).toHaveLength(2);
    expect(top.sites.sort()).toEqual(['chesscom', 'lichess']);
    expect(top.score).toBe(300);
    expect(top.bestSan).toBe('d5');
  });
});

describe('engine wrapper', () => {
  it('parses UCI output, ignoring bound scores', async () => {
    let listener: (l: string) => void = () => {};
    const ch: UciChannel = {
      onLine: (cb) => (listener = cb),
      terminate: () => {},
      send: (cmd) => {
        const reply = (lines: string[]) => setTimeout(() => lines.forEach((l) => listener(l)));
        if (cmd === 'uci') reply(['id name SF', 'uciok']);
        if (cmd === 'isready') reply(['readyok']);
        if (cmd.startsWith('go'))
          reply([
            'info depth 15 seldepth 20 multipv 1 score cp 40 nodes 1 pv e2e4 e7e5',
            'info depth 16 seldepth 21 multipv 1 score cp 90 lowerbound nodes 2 pv d2d4',
            'info depth 16 seldepth 22 multipv 1 score cp 35 nodes 3 pv d2d4 d7d5 c2c4',
            'bestmove d2d4 ponder d7d5',
          ]);
      },
    };
    const e = new Engine(ch);
    await e.init();
    expect(await e.evaluate('startpos', 16)).toEqual({ cp: 35, best: 'd2d4', depth: 16 });
  });
});
