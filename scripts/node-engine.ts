import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Engine, EnginePool, type UciChannel } from '../src/core/analysis/engine';

const require = createRequire(import.meta.url);

/** The same Stockfish build the web app runs, as a Node child process speaking UCI over stdio. */
export function nodeChannel(): UciChannel {
  const path: string = require('stockfish').findEngine('lite-single');
  const proc = spawn(process.execPath, [path], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  let listener: (line: string) => void = () => {};
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) listener(line);
    }
  });
  return {
    send: (cmd) => proc.stdin.write(cmd + '\n'),
    onLine: (cb) => (listener = cb),
    terminate: () => {
      proc.stdin.write('quit\n');
      proc.stdin.end();
    },
  };
}

export async function nodePool(size: number, hashMb = 16): Promise<EnginePool> {
  const engines = Array.from({ length: size }, () => new Engine(nodeChannel()));
  await Promise.all(engines.map((e) => e.init(hashMb)));
  return new EnginePool(engines);
}
