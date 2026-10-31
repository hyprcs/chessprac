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

/** Plies of the main line kept with an evaluation. */
export const PV_PLIES = 16;

/** The parts of a UCI "info" line we use. */
export interface InfoLine {
  depth: number;
  multipv: number;
  /** Side to move, capped like every other score. */
  cp: number;
  wdl?: [number, number, number];
  pv?: string[];
}

/** Parses an "info" line that carries an exact score; null for anything else (bounds, currmove, strings). */
export function parseInfo(line: string): InfoLine | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  let depth: number | undefined;
  let cp: number | undefined;
  let multipv = 1;
  let wdl: [number, number, number] | undefined;
  let pv: string[] | undefined;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'string':
      case 'lowerbound':
      case 'upperbound':
        return null;
      case 'depth':
        depth = Number(t[++i]);
        break;
      case 'multipv':
        multipv = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        cp = kind === 'cp' ? clampCp(v) : mateToCp(v || -1);
        break;
      }
      case 'wdl':
        wdl = [Number(t[i + 1]), Number(t[i + 2]), Number(t[i + 3])];
        i += 3;
        break;
      case 'pv':
        pv = t.slice(i + 1);
        i = t.length;
        break;
    }
  }
  return depth === undefined || cp === undefined ? null : { depth, multipv, cp, wdl, pv };
}

/** One Stockfish instance. Requests are queued; one search runs at a time. */
export class Engine {
  private waiters: Pending[] = [];
  private infoHandler: ((line: string) => void) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private multiPv = 1;

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
    this.ch.send('setoption name UCI_ShowWDL value true');
    const ready = this.until((l) => l === 'readyok');
    this.ch.send('isready');
    await ready;
  }

  /**
   * Evaluate a position to a fixed depth. Score is from the side to move.
   * With `lines` > 1 it also searches the runner-up move (MultiPV), which
   * costs extra time, so only ask for it where it's needed.
   */
  evaluate(fen: string, depth: number, lines = 1): Promise<EvalEntry> {
    const run = async (): Promise<EvalEntry> => {
      // The latest exact score for each line; the last ones before "bestmove" are from the deepest search.
      const latest: InfoLine[] = [];
      this.infoHandler = (line) => {
        const info = parseInfo(line);
        if (info && info.multipv <= lines) latest[info.multipv - 1] = info;
      };
      let best: string | null = null;
      const done = this.until((l) => {
        if (!l.startsWith('bestmove')) return false;
        const mv = l.split(' ')[1];
        best = mv && mv !== '(none)' ? mv : null;
        return true;
      });
      if (lines !== this.multiPv) {
        this.ch.send(`setoption name MultiPV value ${lines}`);
        this.multiPv = lines;
      }
      this.ch.send(`position fen ${fen}`);
      this.ch.send(`go depth ${depth}`);
      await done;
      this.infoHandler = null;
      const [top, runnerUp] = latest;
      const e: EvalEntry = { cp: top?.cp ?? 0, best: best ?? top?.pv?.[0] ?? null, depth: top?.depth ?? 0, pv: top?.pv?.slice(0, PV_PLIES) ?? [] };
      if (top?.wdl) e.wdl = top.wdl;
      if (lines > 1) e.second = runnerUp?.pv?.length ? { cp: runnerUp.cp, move: runnerUp.pv[0] } : null;
      return e;
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
  /** Lines to search (MultiPV); 1 unless said otherwise. */
  multiPv?: number;
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
          const ev = await engine.evaluate(job.fen, depth, job.multiPv);
          onResult(job, ev, ++done, jobs.length);
        }
      }),
    );
  }

  terminate(): void {
    for (const e of this.engines) e.terminate();
  }
}
