import { signal } from '@preact/signals';
import type { MistakeGroup } from '../../core/mistakes';

export type Tab = 'mistakes' | 'openings' | 'drill' | 'profile';

export const tab = signal<Tab>(readTab());

function readTab(): Tab {
  const t = location.hash.replace('#', '') as Tab;
  return ['mistakes', 'openings', 'drill', 'profile'].includes(t) ? t : 'mistakes';
}

export function go(t: Tab) {
  tab.value = t;
  history.replaceState(null, '', `#${t}`);
}

/** Positions the "Drill this" buttons hand to the drill tab. */
export const drillRequest = signal<MistakeGroup[] | null>(null);

export function practise(groups: MistakeGroup[]) {
  drillRequest.value = groups;
  go('drill');
}
