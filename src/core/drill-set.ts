import type { MistakeGroup } from './mistakes';
import { isDue, type DrillCard } from './srs';

export type SetKind = 'recurring' | 'top25' | 'all';

export const SET_LABELS: Record<SetKind, string> = {
  recurring: 'Recurring (wrong 2+ times)',
  top25: 'Top 25 by cost',
  all: 'Every flagged position',
};

/** The positions to drill, best first, from mistakes already ranked and filtered. */
export function drillSet(ranked: MistakeGroup[], kind: SetKind): MistakeGroup[] {
  const withBest = ranked.filter((g) => g.best);
  if (kind === 'recurring') return withBest.filter((g) => g.occurrences.length >= 2);
  if (kind === 'top25') return withBest.slice(0, 25);
  return withBest;
}

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/**
 * Today's recall queue: every card in the set that's due, oldest due first,
 * then positions never drilled, in rank order, up to the daily allowance of
 * new cards still left today.
 */
export function dueQueue(
  set: MistakeGroup[],
  cards: Map<string, DrillCard>,
  newPerDay: number,
  now = new Date(),
): { group: MistakeGroup; isNew: boolean }[] {
  const due = set
    .filter((g) => cards.has(g.key) && isDue(cards.get(g.key)!, now))
    .sort((a, b) => cards.get(a.key)!.card.due.getTime() - cards.get(b.key)!.card.due.getTime());
  const today = startOfDay(now);
  const introducedToday = [...cards.values()].filter((c) => c.addedAt >= today).length;
  const fresh = set.filter((g) => !cards.has(g.key)).slice(0, Math.max(0, newPerDay - introducedToday));
  return [...due.map((group) => ({ group, isNew: false })), ...fresh.map((group) => ({ group, isNew: true }))];
}
