import { Engine, EnginePool, type UciChannel } from '../core/analysis/engine';

const ENGINE_URL = 'engine/stockfish-19-lite-single.js';

/** Stockfish (single-threaded lite WASM) in a Web Worker; needs no special headers, so it runs on GitHub Pages. */
function workerChannel(): UciChannel {
  const worker = new Worker(new URL(ENGINE_URL, document.baseURI));
  let listener: (line: string) => void = () => {};
  worker.onmessage = (e) => {
    for (const line of String(e.data).split('\n')) if (line.trim()) listener(line.trim());
  };
  return {
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => (listener = cb),
    terminate: () => worker.terminate(),
  };
}

export const autoWorkers = () => Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

export async function browserPool(size: number): Promise<EnginePool> {
  const engines = Array.from({ length: size }, () => new Engine(workerChannel()));
  await Promise.all(engines.map((e) => e.init(16)));
  return new EnginePool(engines);
}

let drill: Promise<Engine> | null = null;

/** One engine kept for drills, separate from the background analysis pool. */
export function drillEngine(): Promise<Engine> {
  drill ??= (async () => {
    const e = new Engine(workerChannel());
    await e.init(32);
    return e;
  })();
  return drill;
}
