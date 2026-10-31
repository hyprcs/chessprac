import { useEffect, useMemo, useRef } from 'preact/hooks';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Chess } from 'chess.js';

/** chessground on a square, responsive container. `config` is re-applied whenever it changes. */
export function Board({ config, onApi, small }: { config: Config; onApi?: (api: Api) => void; small?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  useEffect(() => {
    api.current = Chessground(el.current!, config);
    onApi?.(api.current);
    return () => api.current?.destroy();
  }, []);
  useEffect(() => {
    api.current?.set(config);
  }, [config]);
  return (
    <div class={small ? 'board board-small' : 'board'}>
      <div ref={el} class="cg-wrap" />
    </div>
  );
}

/** Legal destinations for chessground, from chess.js. */
export function dests(chess: Chess): Map<Key, Key[]> {
  const m = new Map<Key, Key[]>();
  for (const mv of chess.moves({ verbose: true })) {
    const from = mv.from as Key;
    m.set(from, [...(m.get(from) ?? []), mv.to as Key]);
  }
  return m;
}

export const arrow = (uci: string, brush: 'green' | 'red' | 'blue' | 'yellow'): DrawShape => ({
  orig: uci.slice(0, 2) as Key,
  dest: uci.slice(2, 4) as Key,
  brush,
});

export const lastMoveOf = (uci: string | null | undefined): Key[] | undefined =>
  uci ? [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key] : undefined;

/** A static board for lists. */
export function MiniBoard({ fen, color, shapes }: { fen: string; color: 'white' | 'black'; shapes: DrawShape[] }) {
  const shapeKey = shapes.map((s) => `${s.orig}${s.dest}${s.brush}`).join();
  const config = useMemo<Config>(
    () => ({
      fen,
      orientation: color,
      viewOnly: true,
      coordinates: false,
      drawable: { enabled: false, visible: true, autoShapes: shapes },
    }),
    [fen, color, shapeKey],
  );
  return <Board small config={config} />;
}
