import { computed, effect } from '@preact/signals';
import { MIN_GAMES, nextInsightState } from '../core/insights';
import { analysisState, pendingGames } from './analysis';
import { analyses, games, lookup, profile, saveInsights, settings } from './state';

/** Enough analysed games to pin a first insight before the whole backlog is done. */
const EARLY_GAMES = 200;

export const insightShown = computed(() => profile.value?.insights?.current ?? null);

/** Analysed games so far, against what the first insight needs. */
export const insightProgress = computed(() => {
  const analysed = games.value.filter((g) => g.timeControl.kind === 'live' && analyses.value.has(g.id)).length;
  return { analysed, needed: MIN_GAMES };
});

let checking = false;

/**
 * Pins the first insight once the analysis has finished (or got far enough),
 * and swaps it for a new one when it's due. Runs whenever the analysis stops;
 * cheap when nothing is due, since the rotation check comes first.
 */
export async function refreshInsight(now = Date.now()): Promise<void> {
  const p = profile.value;
  if (!p || checking || analysisState.value.running) return;
  if (pendingGames() > 0 && insightProgress.value.analysed < EARLY_GAMES) return;
  checking = true;
  try {
    const next = nextInsightState(p.insights, { games: games.value, analyses: analyses.value, lookup, thresholdCp: settings.value.thresholdCp }, now);
    if (next && profile.value?.id === p.id) await saveInsights(next);
  } finally {
    checking = false;
  }
}

export async function markInsightSeen(): Promise<void> {
  const s = profile.value?.insights;
  if (s?.current && !s.current.seenAt) await saveInsights({ ...s, current: { ...s.current, seenAt: Date.now() } });
}

// Each time the analysis stops (finished, paused, or had nothing to do after a sync or profile switch).
// The check runs outside the effect so it only subscribes to `running`, and after a paint so it never holds up the page.
effect(() => {
  if (!analysisState.value.running) setTimeout(() => void refreshInsight(), 50);
});
