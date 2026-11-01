import { signal } from '@preact/signals';
import type { MistakeGroup } from '../../core/mistakes';

export type Tab = 'mistakes' | 'openings' | 'drill' | 'profile';

export const tab = signal<Tab>(readTab());

function readTab(): Tab {
  const t = location.hash.replace('#', '') as Tab;
  return ['mistakes', 'openings', 'drill', 'profile'].includes(t) ? t : 'mistakes';
}

window.addEventListener('hashchange', () => (tab.value = readTab()));

export function go(t: Tab) {
  tab.value = t;
  history.replaceState(null, '', `#${t}`);
}

/** Positions the "Drill this" buttons hand to the drill tab, and how to drill them. */
export const drillRequest = signal<{ groups: MistakeGroup[]; mode: 'practice' | 'speed' } | null>(null);

export function practise(groups: MistakeGroup[], mode: 'practice' | 'speed' = 'practice') {
  drillRequest.value = { groups, mode };
  go('drill');
}
