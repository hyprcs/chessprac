/** Header tags of a single-game PGN. */
export function pgnHeaders(pgn: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) out[m[1]] = m[2];
  return out;
}

/**
 * SAN tokens of a single-game PGN's mainline. Much faster than loading the
 * PGN into chess.js; legality is checked later when the moves are replayed.
 */
export function pgnMoves(pgn: string): string[] {
  let text = pgn.replace(/^\[.*\]\s*$/gm, '');
  text = text.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  // Strip variations, innermost first.
  let prev;
  do {
    prev = text;
    text = text.replace(/\([^()]*\)/g, ' ');
  } while (text !== prev);
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t && !/^(\$\d+|1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}
