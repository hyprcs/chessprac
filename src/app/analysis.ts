import { signal } from '@preact/signals';
import type { EvalEntry, GameAnalysis, GameRecord } from '../core/types';
import { analyseGame, bestMoveJobs, enginePositions, usable } from '../core/analysis/analyse';
import type { EnginePool, EvalJob } from '../core/analysis/engine';
import * as store from './db';
import { analyses, currentId, evals, evalsVersion, games, lookup, onProfileLoaded, settings } from './state';
import { autoWorkers, browserPool } from './engine';

export interface AnalysisState {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  startedAt: number;
  /** Games still waiting for the engine (shown even while paused). */
  gamesLeft: number;
  error: string | null;
}

export const analysisState = signal<AnalysisState>({
  running: false,
  phase: '',
  done: 0,
  total: 0,
  startedAt: 0,
  gamesLeft: 0,
  error: null,
});

let controller: AbortController | null = null;
let pool: EnginePool | null = null;
let rerun = false;

const yieldToUi = () => new Promise((r) => setTimeout(r));

function needsAnalysis(a: GameAnalysis | undefined, depth: number, maxPly: number) {
  return !a || a.depth < depth || a.maxPly !== maxPly;
}

export function pendingGames(): number {
  const { depth, maxPly } = settings.value;
  return games.value.filter((g) => needsAnalysis(analyses.value.get(g.id), depth, maxPly)).length;
}

/**
 * Scores every game not yet analysed at the current settings, newest first.
 * Evaluations are saved as they arrive, so stopping (or closing the tab) loses
 * at most a couple of seconds of work; the next run carries on from there.
 */
export async function startAnalysis(): Promise<void> {
  if (analysisState.value.running) {
    rerun = true;
    return;
  }
  const profileId = currentId.value;
  if (!profileId) return;
  const { depth, maxPly, thresholdCp } = settings.value;
  const workers = settings.value.workers || autoWorkers();
  const pending = games.value
    .filter((g) => needsAnalysis(analyses.value.get(g.id), depth, maxPly))
    .sort((a, b) => b.playedAt - a.playedAt);

  controller = new AbortController();
  const { signal: abort } = controller;
  const set = (patch: Partial<AnalysisState>) => (analysisState.value = { ...analysisState.value, ...patch });
  set({ running: true, phase: 'Preparing', done: 0, total: 0, startedAt: Date.now(), gamesLeft: pending.length, error: null });

  const stillCurrent = () => currentId.value === profileId;
  let writing: Promise<void> = Promise.resolve();
  const evalBuffer: [string, EvalEntry][] = [];
  const readyBuffer: GameRecord[] = [];

  const commit = async (ready: GameRecord[]) => {
    const out = ready.map((g) => analyseGame(g, maxPly, depth, lookup)).filter((a): a is GameAnalysis => a !== null);
    if (!out.length) return;
    await store.putAnalyses(out);
    if (stillCurrent()) {
      const next = new Map(analyses.value);
      for (const a of out) next.set(a.gameId, a);
      analyses.value = next;
    }
  };
  const flush = () => {
    const e = evalBuffer.splice(0);
    const r = readyBuffer.splice(0);
    writing = writing.then(async () => {
      if (e.length) await store.putEvals(e);
      await commit(r);
      evalsVersion.value++;
    });
    return writing;
  };

  try {
    // Which positions each game still needs, and which games wait on each position.
    const missing = new Map<string, Set<string>>();
    const waiting = new Map<string, string[]>();
    const jobs: EvalJob[] = [];
    const ready: GameRecord[] = [];
    for (const [i, g] of pending.entries()) {
      const need = new Set<string>();
      for (const j of enginePositions(g, maxPly)) {
        if (usable(evals.get(j.key), depth)) continue;
        need.add(j.key);
        if (!waiting.has(j.key)) {
          waiting.set(j.key, []);
          jobs.push(j);
        }
        waiting.get(j.key)!.push(g.id);
      }
      if (need.size) missing.set(g.id, need);
      else ready.push(g);
      if (i % 25 === 24) await yieldToUi();
    }
    await commit(ready);
    const byId = new Map(pending.map((g) => [g.id, g]));
    let gamesLeft = missing.size;
    set({ gamesLeft });

    if (jobs.length && !abort.aborted) {
      set({ phase: 'Starting engines', total: jobs.length });
      pool = await browserPool(workers);
      set({ phase: 'Analysing', startedAt: Date.now() });
      let lastFlush = Date.now();
      await pool.evaluateAll(
        jobs,
        depth,
        (job, ev, done) => {
          evals.set(job.key, ev);
          evalBuffer.push([job.key, ev]);
          for (const id of waiting.get(job.key) ?? []) {
            const need = missing.get(id)!;
            need.delete(job.key);
            if (!need.size) {
              missing.delete(id);
              readyBuffer.push(byId.get(id)!);
              gamesLeft--;
            }
          }
          set({ done, gamesLeft });
          if (Date.now() - lastFlush > 2000) {
            lastFlush = Date.now();
            void flush();
          }
        },
        abort,
      );
      await flush();
    }

    // Lichess only names a better move when it judged a move bad, so fill in the rest.
    if (!abort.aborted && stillCurrent()) {
      const best = bestMoveJobs([...analyses.value.values()], thresholdCp, lookup);
      if (best.length) {
        set({ phase: 'Finding best moves', done: 0, total: best.length });
        pool ??= await browserPool(Math.min(workers, best.length));
        await pool.evaluateAll(best, depth, (job, ev, done) => {
          evals.set(job.key, ev);
          evalBuffer.push([job.key, ev]);
          set({ done });
        }, abort);
        await flush();
      }
    }
    set({ running: false, phase: abort.aborted ? 'Paused' : 'Done' });
  } catch (e) {
    set({ running: false, phase: 'Stopped', error: (e as Error).message });
  } finally {
    pool?.terminate();
    pool = null;
    controller = null;
  }
  if (rerun) {
    rerun = false;
    void startAnalysis();
  }
}

export function pauseAnalysis(): void {
  rerun = false;
  controller?.abort();
}

onProfileLoaded.push(() => {
  if (analysisState.value.running) pauseAnalysis();
  void startAnalysis();
});
