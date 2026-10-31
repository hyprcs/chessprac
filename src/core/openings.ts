import { Chess } from 'chess.js';
import type { Opening } from './types';
import { positionKey } from './position';
import book from '../data/openings.json';

const BOOK = book as unknown as Record<string, [string, string]>;

/** Names players know better than the book's. */
const ALIASES: Record<string, string> = {
  'Caro-Kann Defense: Maróczy Variation': 'Caro-Kann Defense: Fantasy (Maróczy) Variation',
};

export function parseOpeningName(eco: string, raw: string): Opening {
  const name = Object.entries(ALIASES).reduce(
    (n, [from, to]) => (n === from || n.startsWith(from + ',') ? to + n.slice(from.length) : n),
    raw,
  );
  const [family, rest] = name.split(': ');
  const variation = rest ? `${family}: ${rest.split(', ')[0]}` : family;
  return { eco, name, family, variation };
}

/** Deepest book position reached in the game (transpositions included). */
export function classifyOpening(moves: string[], maxPlies = 40): Opening | null {
  const chess = new Chess();
  let hit: [string, string] | undefined;
  for (let i = 0; i < moves.length && i < maxPlies; i++) {
    chess.move(moves[i]);
    hit = BOOK[positionKey(chess.fen())] ?? hit;
  }
  return hit ? parseOpeningName(hit[0], hit[1]) : null;
}
