/** Centipawn cap. Mate scores map to ±MATE_CP so one blunder can't swamp the rankings. */
export const MATE_CP = 1000;

export const clampCp = (cp: number) => Math.max(-MATE_CP, Math.min(MATE_CP, cp));

/** A mate-in-n score (positive: side to move mates) as capped centipawns. */
export const mateToCp = (n: number) => (n > 0 ? MATE_CP : -MATE_CP);
