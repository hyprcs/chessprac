import { describe, expect, it, vi } from 'vitest';
import type { EvalJob } from '../src/core/analysis/engine';
import type { EvalEntry, GameRecord } from '../src/core/types';
import { positionKey, replay } from '../src/core/position';
import { analyses, currentId, evals, games } from '../src/app/state';
import { analysisState, startAnalysis } from '../src/app/analysis';

vi.mock('../src/app/db', () => ({ putEvals: async () => {}, putAnalyses: async () => {} }));
vi.mock('../src/app/engine', () => ({
  autoWorkers: () => 1,
  // Evaluates jobs in order, like a pool of one engine.
  browserPool: async () => ({
    evaluateAll: async (jobs: EvalJob[], depth: number, onResult: (job: EvalJob, ev: EvalEntry, done: number) => void) =>
      jobs.forEach((job, i) => onResult(job, { cp: 0, best: 'a2a3', depth }, i + 1)),
    terminate: () => {},
  }),
}));

describe('background analysis', () => {
  it('finishes a game that repeats a position, even when the repeat is the last one evaluated', async () => {
    // Nf3 Nf6 Ng1 Ng8 Nf3: my first and third moves are played from the same position, and reach the same one.
    const moves = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3'];
    const g = {
      id: 'chesscom:rep', site: 'chesscom', siteId: 'rep', url: 'https://x/rep', playedAt: 0, account: 'me', color: 'white',
      opponent: 'o', timeControl: { kind: 'live', base: 180, inc: 0 }, speed: 'blitz', siteSpeed: 'blitz', rated: true,
      myRating: null, oppRating: null, result: 'draw', opening: null, siteOpening: null, moves,
    } as GameRecord;
    // Already know the positions around my second move, so the game waits only on the repeated ones.
    const plies = replay(moves);
    for (const fen of [plies[2].fenBefore, plies[2].fenAfter]) evals.set(positionKey(fen), { cp: 0, best: 'a2a3', depth: 16 });

    currentId.value = 'p';
    games.value = [g];
    await startAnalysis();

    expect(analysisState.value.error).toBeNull();
    expect(analysisState.value.phase).toBe('Done');
    expect(analyses.value.get(g.id)?.moves).toHaveLength(3);
  });
});
