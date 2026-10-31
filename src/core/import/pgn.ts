/** Header tags of a single-game PGN. */
export function pgnHeaders(pgn: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) out[m[1]] = m[2];
  return out;
}

/** "[%clk 0:02:58.7]" in a comment -> 178.7 seconds. */
function clockOf(comment: string): number | null {
  const m = /\[%clk\s+(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\]/.exec(comment);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/**
 * SAN tokens of a single-game PGN's mainline, with the seconds left after
 * each move from its [%clk] comment (null where there is none). Much faster
 * than loading the PGN into chess.js; legality is checked later when the
 * moves are replayed.
 */
export function pgnMainline(pgn: string): { moves: string[]; clocks: (number | null)[] } {
  const text = pgn.replace(/^\[.*\]\s*$/gm, '');
  const moves: string[] = [];
  const clocks: (number | null)[] = [];
  let depth = 0; // inside variations
  // Comments first, so brackets inside them don't count as variations.
  for (const m of text.matchAll(/\{([^}]*)\}|;[^\n]*|\(|\)|[^\s{}();]+/g)) {
    const tok = m[0];
    if (tok === '(') depth++;
    else if (tok === ')') depth = Math.max(0, depth - 1);
    else if (depth > 0 || tok.startsWith(';')) continue;
    else if (m[1] !== undefined) {
      const c = clockOf(m[1]);
      if (c !== null && moves.length) clocks[moves.length - 1] = c;
    } else {
      const san = tok.replace(/^\d+\.+/, '');
      if (san && !/^(\$\d+|1-0|0-1|1\/2-1\/2|\*)$/.test(san)) {
        moves.push(san);
        clocks.push(null);
      }
    }
  }
  return { moves, clocks };
}

export const pgnMoves = (pgn: string): string[] => pgnMainline(pgn).moves;
