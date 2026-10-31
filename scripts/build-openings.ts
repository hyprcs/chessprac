/**
 * Builds src/data/openings.json from the Lichess opening book
 * (github.com/lichess-org/chess-openings, CC0). Keyed by position so a game
 * is classified the same way whichever site it came from and whatever move
 * order reached the position.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Chess } from 'chess.js';
import { positionKey } from '../src/core/position';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';

async function main() {
  const book: Record<string, [string, string]> = {};
  let rows = 0;
  for (const file of ['a', 'b', 'c', 'd', 'e']) {
    const res = await fetch(`${BASE}${file}.tsv`);
    if (!res.ok) throw new Error(`${file}.tsv: HTTP ${res.status}`);
    const lines = (await res.text()).trim().split('\n').slice(1);
    for (const line of lines) {
      const [eco, name, pgn] = line.split('\t');
      const chess = new Chess();
      for (const tok of pgn.split(/\s+/)) if (!/^\d+\.$/.test(tok)) chess.move(tok);
      book[positionKey(chess.fen())] = [eco, name];
      rows++;
    }
  }
  mkdirSync('src/data', { recursive: true });
  writeFileSync('src/data/openings.json', JSON.stringify(book));
  console.log(`${rows} book lines, ${Object.keys(book).length} positions`);
}

main();
