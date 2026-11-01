/** Centipawn cap. Mate scores map to ±MATE_CP so one blunder can't swamp the rankings. */
export const MATE_CP = 1000;

export const clampCp = (cp: number) => Math.max(-MATE_CP, Math.min(MATE_CP, cp));

/** A mate-in-n score (positive: side to move mates) as capped centipawns. */
export const mateToCp = (n: number) => (n > 0 ? MATE_CP : -MATE_CP);

/** Expected score (0–1) for the side with this evaluation: Lichess's curve, fitted to real games. */
export const expectedScore = (cp: number) => 1 / (1 + Math.exp(-0.00368208 * cp));

/** Expected score from the two players' ratings (Elo formula). */
export const ratingExpectation = (mine: number, theirs: number) => 1 / (1 + 10 ** ((theirs - mine) / 400));

/** Rating points one point per game of extra score is worth, near a 50% score (the Elo curve's slope there). */
export const ELO_PER_POINT = 1600 / Math.LN10;
