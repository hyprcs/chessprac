import type { EvalEntry } from '../types';
import { clampCp, mateToCp } from '../score';

/** A line-based UCI connection: a Web Worker in the browser, a child process in Node. */
export interface UciChannel {
  send(cmd: string): void;
  onLine(cb: (line: string) => void): void;
  terminate(): void;
}

interface Pending {
  match: (line: string) => boolean;
  resolve: () => void;
}

/** One Stockfish instance. Requests are queued; one search runs at a time. */
export class Engine {
  private waiters: Pending[] = [];
  private infoHandler: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private ch: UciChannel) {
    ch.onLine((line) => {
      if (line.startsWith('info ')) this.infoHandler?.(line);
      const i = this.waiters.findIndex((w) => w.match(line));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve();
    });
  }

  private until(match: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  async init(hashMb = 16): Promise<void> {
    const ok = this.until((l) => l === 'uciok');
    this.ch.send('uci');
    await ok;
    this.ch.send(`setoption name Hash value ${hashMb}`);
    const ready = this.until((l) => l === 'readyok');
    this.ch.send('isready');
    await ready;
  }

  /** Evaluate a position to a fixed depth. Score is from the side to move. */
  evaluate(fen: string, depth: number): Promise<EvalEntry> {
    const run = async (): Promise<EvalEntry> => {
      let cp = 0;
      let reached = 0;
      let pvMove: string | null = null;
      this.infoHandler = (line) => {
        const m = /\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)( lowerbound| upperbound)?.*?(?:\bpv (\S+).*)?$/.exec(line);
        if (!m || m[4] || /\bmultipv [2-9]/.test(line)) return;
        reached = Number(m[1]);
        cp = m[2] === 'cp' ? clampCp(Number(m[3])) : mateToCp(Number(m[3]) || -1);
        if (m[5]) pvMove = m[5];
      };
      let best: string | null = null;
      const done = this.until((l) => {
        if (!l.startsWith('bestmove')) return false;
        const mv = l.split(' ')[1];
        best = mv && mv !== '(none)' ? mv : null;
        return true;
      });
      this.ch.send(`position fen ${fen}`);
      this.ch.send(`go depth ${depth}`);
      await done;
      this.infoHandler = null;
      return { cp, best: best ?? pvMove, depth: reached };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Forget hash entries between unrelated games, so results don't depend on order. */
  newGame(): void {
    this.ch.send('ucinewgame');
  }

  terminate(): void {
    this.ch.terminate();
  }
}

export interface EvalJob {
  key: string;
  fen: string;
}

/** Several single-threaded engines working through a shared list. */
export class EnginePool {
  constructor(private engines: Engine[]) {}

  get size() {
    return this.engines.length;
  }

  async evaluateAll(
    jobs: EvalJob[],
    depth: number,
    onResult: (job: EvalJob, ev: EvalEntry, done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    let next = 0;
    let done = 0;
    await Promise.all(
      this.engines.map(async (engine) => {
        while (next < jobs.length && !signal?.aborted) {
          const job = jobs[next++];
          const ev = await engine.evaluate(job.fen, depth);
          onResult(job, ev, ++done, jobs.length);
        }
      }),
    );
  }

  terminate(): void {
    for (const e of this.engines) e.terminate();
  }
}
