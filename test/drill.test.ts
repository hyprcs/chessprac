import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { buildReplyIndex, topReply } from '../src/core/replies';
import { drillSet, dueQueue } from '../src/core/drill-set';
import { newDrillCard, review, reviveDrillCard, isDue } from '../src/core/srs';
import { positionKey } from '../src/core/position';
import type { MistakeGroup } from '../src/core/mistakes';
import type { GameRecord } from '../src/core/types';

function game(moves: string[], color: 'white' | 'black', id: string, site: 'chesscom' | 'lichess' = 'chesscom'): GameRecord {
  return {
    id: `${site}:${id}`, site, siteId: id, url: '', playedAt: 0, account: 'me', color, opponent: 'o',
    timeControl: { kind: 'live', base: 180, inc: 0 }, speed: 'blitz', siteSpeed: 'blitz', rated: true,
    myRating: null, oppRating: null, result: 'win', opening: null, siteOpening: null, moves,
  };
}

const keyAfter = (sans: string[]) => {
  const c = new Chess();
  sans.forEach((s) => c.move(s));
  return positionKey(c.fen());
};

describe('opponent replies', () => {
  it("counts only the opponent's moves, across sites", () => {
    const index = buildReplyIndex([
      game(['e4', 'c6', 'd4', 'd5', 'Nc3'], 'black', 'a'),
      game(['e4', 'c6', 'd4', 'd5', 'e5'], 'black', 'b', 'lichess'),
      game(['e4', 'c6', 'd4', 'd5', 'e5'], 'black', 'c'),
    ]);
    const afterD5 = keyAfter(['e4', 'c6', 'd4', 'd5']);
    expect(topReply(index, afterD5)).toEqual({ uci: 'e4e5', count: 2, total: 3 });
    // My own moves are not "replies".
    expect(index.has(keyAfter(['e4']))).toBe(false);
  });
});

function group(key: string, n: number, score: number, best: string | null = 'e2e4'): MistakeGroup {
  return {
    key, fen: '', color: 'white', occurrences: Array.from({ length: n }, () => ({}) as never), reached: n, played: new Map(),
    best, bestSan: null, avgLoss: score / n, score, sites: ['chesscom'],
  };
}

describe('drill sets and the due queue', () => {
  const ranked = [group('a', 3, 900), group('b', 1, 500), group('c', 2, 300), group('d', 4, 200, null)];

  it('picks recurring positions that have a best move', () => {
    expect(drillSet(ranked, 'recurring').map((g) => g.key)).toEqual(['a', 'c']);
    expect(drillSet(ranked, 'all').map((g) => g.key)).toEqual(['a', 'b', 'c']);
  });

  it('puts due cards first, then new ones up to the daily allowance', () => {
    const now = new Date('2026-11-01T12:00:00');
    const yesterday = new Date('2026-10-31T12:00:00');
    const dueCard = { ...newDrillCard('p', 'c', '', 'white', yesterday), addedAt: yesterday.getTime() };
    const cards = new Map([['c', dueCard]]);
    const q = dueQueue(drillSet(ranked, 'all'), cards, 1, now);
    expect(q.map((x) => [x.group.key, x.isNew])).toEqual([['c', false], ['a', true]]);
  });

  it('counts new cards introduced today against the allowance', () => {
    const now = new Date('2026-11-01T12:00:00');
    const todayCard = newDrillCard('p', 'x', '', 'white', new Date('2026-11-01T09:00:00'));
    todayCard.card = { ...todayCard.card, due: new Date('2026-11-02T09:00:00') };
    const q = dueQueue(drillSet(ranked, 'all'), new Map([['x', todayCard]]), 1, now);
    expect(q).toHaveLength(0);
  });
});

describe('FSRS cards', () => {
  it('schedules a right answer later than a wrong one', () => {
    const now = new Date('2026-11-01T12:00:00');
    const c = newDrillCard('p', 'k', '', 'black', now);
    const right = review(c, true, 3000, now);
    const wrong = review(c, false, 3000, now);
    expect(right.card.due.getTime()).toBeGreaterThan(wrong.card.due.getTime());
    expect(right.history).toEqual([{ at: now.getTime(), correct: true }]);
    expect(isDue(wrong, new Date('2026-11-02T12:00:00'))).toBe(true);
  });

  it('survives a JSON round trip', () => {
    const c = review(newDrillCard('p', 'k', '', 'black'), true, 1000);
    const back = reviveDrillCard(JSON.parse(JSON.stringify(c)));
    expect(back.card.due).toBeInstanceOf(Date);
    expect(back.card.due.getTime()).toBe(c.card.due.getTime());
  });
});
