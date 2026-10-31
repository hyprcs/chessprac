import { Chess } from 'chess.js';
import type { GameRecord } from './types';
import { positionKey } from './position';

/** Position key -> opponent's move (UCI) -> how often they played it against me. */
export type ReplyIndex = Map<string, Map<string, number>>;

/** Record what my opponent played in every position where it was their move. */
export function addGameReplies(index: ReplyIndex, game: GameRecord, maxPly = 60): void {
  const chess = new Chess();
  const theirs = game.color === 'white' ? 1 : 0;
  for (let i = 0; i < game.moves.length && i < maxPly; i++) {
    const before = chess.fen();
    const m = chess.move(game.moves[i]);
    if (i % 2 !== theirs) continue;
    const key = positionKey(before);
    const counts = index.get(key) ?? new Map<string, number>();
    counts.set(m.lan, (counts.get(m.lan) ?? 0) + 1);
    index.set(key, counts);
  }
}

export function buildReplyIndex(games: GameRecord[], maxPly = 60): ReplyIndex {
  const index: ReplyIndex = new Map();
  for (const g of games) addGameReplies(index, g, maxPly);
  return index;
}

/** The reply opponents chose most often here, or null if no opponent ever reached it. */
export function topReply(index: ReplyIndex, key: string): { uci: string; count: number; total: number } | null {
  const counts = index.get(key);
  if (!counts) return null;
  let best: [string, number] | null = null;
  let total = 0;
  for (const entry of counts) {
    total += entry[1];
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best && { uci: best[0], count: best[1], total };
}
