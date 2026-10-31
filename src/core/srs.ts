import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';
import type { Color } from './types';

/** Spaced-repetition state for one drilled position in one profile. */
export interface DrillCard {
  profileId: string;
  /** Position key (FEN without move counters). */
  key: string;
  fen: string;
  color: Color;
  card: Card;
  addedAt: number;
  /** Most recent results, newest last, capped at HISTORY. */
  history: { at: number; correct: boolean }[];
}

const HISTORY = 20;
/** A right answer that took this long counts as "hard" rather than "good". */
export const SLOW_MS = 15_000;

const scheduler = fsrs({ enable_fuzz: true });

export function newDrillCard(profileId: string, key: string, fen: string, color: Color, now = new Date()): DrillCard {
  return { profileId, key, fen, color, card: createEmptyCard(now), addedAt: now.getTime(), history: [] };
}

export function gradeFor(correct: boolean, ms: number): Rating.Again | Rating.Hard | Rating.Good {
  if (!correct) return Rating.Again;
  return ms > SLOW_MS ? Rating.Hard : Rating.Good;
}

export function review(dc: DrillCard, correct: boolean, ms: number, now = new Date()): DrillCard {
  const { card } = scheduler.next(dc.card, now, gradeFor(correct, ms));
  const history = [...dc.history, { at: now.getTime(), correct }].slice(-HISTORY);
  return { ...dc, card, history };
}

export const isDue = (dc: DrillCard, now = new Date()) => dc.card.due.getTime() <= now.getTime();

/** JSON turns Dates into strings; turn them back after reading a profile file. */
export function reviveDrillCard(raw: DrillCard): DrillCard {
  const c = raw.card as Card & { due: Date | string; last_review?: Date | string };
  return {
    ...raw,
    card: { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined },
  };
}
