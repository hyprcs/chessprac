import { Chess } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Position key: FEN without the halfmove and fullmove counters, so the same
 * position reached by a different move order (or on another site) matches.
 * chess.js only writes an en passant square when the capture is legal, so
 * positions that differ only by an unusable ep square already match.
 */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export interface Ply {
  /** 0-based ply index; ply 0 is White's first move. */
  ply: number;
  fenBefore: string;
  san: string;
  uci: string;
  fenAfter: string;
}

/** Replay SAN moves from the start, stopping at maxPlies. Throws on an illegal move. */
export function replay(moves: string[], maxPlies = Infinity): Ply[] {
  const chess = new Chess();
  const out: Ply[] = [];
  for (let i = 0; i < moves.length && i < maxPlies; i++) {
    const m = chess.move(moves[i]);
    out.push({ ply: i, fenBefore: m.before, san: m.san, uci: m.lan, fenAfter: m.after });
  }
  return out;
}

export function sideToMove(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'w' ? 'white' : 'black';
}

/** "12." for White's 12th move, "12..." for Black's. */
export function moveNumberLabel(ply: number): string {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}.` : `${n}...`;
}

/** "1.e4 c6 2.d4 d5 3.Nc3" */
export function formatLine(sans: string[], startPly = 0): string {
  return sans
    .map((san, i) => {
      const ply = startPly + i;
      if (ply % 2 === 0) return `${ply / 2 + 1}.${san}`;
      return i === 0 ? `${moveNumberLabel(ply)}${san}` : san;
    })
    .join(' ');
}

export function uciToSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m.san;
  } catch {
    return null;
  }
}
