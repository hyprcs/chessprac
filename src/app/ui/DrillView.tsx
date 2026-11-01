import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Chess } from 'chess.js';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { MistakeGroup } from '../../core/mistakes';
import { drillSet, dueQueue, SET_LABELS, type SetKind } from '../../core/drill-set';
import { gradeFor, newDrillCard, review } from '../../core/srs';
import type { DrillMode, DrillSession } from '../../core/drill-log';
import { classifyOpening } from '../../core/openings';
import { formatLine } from '../../core/position';
import { cards, getReplyIndex, logAttempt, logSession, newId, profile, ranked, saveCard, settings } from '../state';
import { applyUci, judge, opponentReply, shuffle, type Judgement, type Reply } from '../drill';
import { drillEngine } from '../engine';
import { Board, arrow, dests, lastMoveOf } from './Board';
import { FilterBar } from './Filters';
import { drillRequest } from './drill-request';
import { day, duration, gameLabel, pawns, percent, plural, signedPawns } from './format';

type Mode = DrillMode;

interface Item {
  group: MistakeGroup;
  isNew: boolean;
}

interface Session {
  /** The saved record of this run; its attempts point at its id. */
  log: DrillSession;
  mode: Mode;
  items: Item[];
  index: number;
  continueLine: boolean;
  /** Key -> right on the first attempt this session. Only first attempts are graded. */
  firstTry: Map<string, boolean>;
  startedAt: number;
  finishedAt: number | null;
}

type LogEntry = { mine: true; label: string; san: string; j: Judgement } | { mine: false; label: string; san: string; reply: Reply };

interface Turn {
  fen: string;
  /** 0 is the drilled position; later steps continue the line. */
  step: number;
  phase: 'move' | 'thinking' | 'right' | 'wrong' | 'done';
  lastMove?: string;
  shapes: DrawShape[];
  log: LogEntry[];
  wrong?: { san: string; j: Judgement; label: string };
  shownAt: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "7." or "7..." for the side to move in a FEN. */
function moveLabel(fen: string): string {
  const [, side, , , , full] = fen.split(' ');
  return side === 'w' ? `${full}.` : `${full}...`;
}

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`chessprac.drill.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try {
    localStorage.setItem(`chessprac.drill.${key}`, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function DrillView({ active }: { active: boolean }) {
  const [kind, setKindState] = useState<SetKind>(readPref('set', 'recurring'));
  const [shuffleOn, setShuffle] = useState<boolean>(readPref('shuffle', true));
  const [speedLine, setSpeedLine] = useState<boolean>(readPref('speedLine', false));
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const S = useRef<Session | null>(null);
  const T = useRef<Turn | null>(null);
  const token = useRef(0);
  const api = useRef<Api | null>(null);

  const setKind = (k: SetKind) => {
    setKindState(k);
    writePref('set', k);
  };
  const set = drillSet(ranked.value, kind);
  const queue = dueQueue(set, cards.value, settings.value.newPerDay);

  const setTurn = (t: Turn | null) => {
    T.current = t;
    rerender();
  };

  function show(index: number) {
    const s = S.current!;
    token.current++;
    s.index = index;
    if (index >= s.items.length) {
      s.finishedAt = Date.now();
      s.log = { ...s.log, finishedAt: s.finishedAt };
      void logSession(s.log);
      setTurn(null);
      return;
    }
    setTurn({ fen: s.items[index].group.fen, step: 0, phase: 'move', shapes: [], log: [], shownAt: Date.now() });
  }

  function begin(mode: Mode, items: Item[], from: DrillSession['set'], shuffled = false) {
    if (!items.length) return;
    const continueLine = mode === 'speed' ? speedLine : true;
    const startedAt = Date.now();
    const log: DrillSession = {
      id: newId(),
      profileId: profile.value!.id,
      mode,
      set: from,
      size: items.length,
      shuffled,
      playOn: continueLine,
      startedAt,
      finishedAt: null,
      endedEarly: false,
    };
    void logSession(log);
    S.current = {
      log,
      mode,
      items: [...items],
      index: 0,
      continueLine,
      firstTry: new Map(),
      startedAt,
      finishedAt: null,
    };
    // Warm up while the first position is on screen.
    void getReplyIndex();
    void drillEngine();
    show(0);
  }

  const next = () => S.current && show(S.current.index + 1);
  const stop = () => {
    if (S.current && !S.current.finishedAt) {
      if (S.current.index < S.current.items.length) S.current.log = { ...S.current.log, endedEarly: true };
      S.current.items = S.current.items.slice(0, S.current.index);
      show(S.current.index);
    }
  };
  const close = () => {
    token.current++;
    S.current = null;
    setTurn(null);
  };

  /** Logs every try at a drilled position; the first try in a session also updates its card (recall only). */
  async function recordAttempt(item: Item, uci: string, j: Judgement, at: number, ms: number) {
    const s = S.current!;
    const { key, fen, color } = item.group;
    const correct = j.kind !== 'wrong';
    const firstTry = !s.firstTry.has(key);
    void logAttempt({
      id: newId(),
      profileId: s.log.profileId,
      sessionId: s.log.id,
      key,
      mode: s.mode,
      at,
      ms,
      uci,
      kind: j.kind,
      loss: j.loss,
      firstTry,
      ...(firstTry && s.mode === 'recall' ? { rating: gradeFor(correct, ms) } : {}),
    });
    if (!firstTry) {
      if (!correct && s.mode === 'recall') s.items.push(item);
      return;
    }
    s.firstTry.set(key, correct);
    if (s.mode === 'recall') {
      const p = profile.value!;
      const card = cards.value.get(key) ?? newDrillCard(p.id, key, fen, color);
      await saveCard(review(card, correct, ms));
      if (!correct) s.items.push(item); // see it again before the session ends
    }
  }

  async function onMove(orig: Key, dest: Key) {
    const s = S.current;
    const t = T.current;
    if (!s || !t || t.phase !== 'move') return;
    const my = token.current;
    const chess = new Chess(t.fen);
    const mv = chess.moves({ verbose: true }).find((m) => m.from === orig && m.to === dest && (!m.promotion || m.promotion === 'q'));
    if (!mv) return setTurn({ ...t });
    const item = s.items[s.index];
    const label = moveLabel(t.fen);
    const at = Date.now();
    const ms = at - t.shownAt;
    setTurn({ ...t, phase: 'thinking', fen: mv.after, lastMove: mv.lan, shapes: [] });

    const first = t.step === 0;
    const { altToleranceCp, thresholdCp, lineLength } = settings.value;
    // The drilled move must be (nearly) the best; later moves in the line only need to avoid real mistakes.
    const j = await judge(t.fen, mv.lan, first ? item.group.best : null, first ? altToleranceCp : thresholdCp);
    if (token.current !== my) return;
    if (first) await recordAttempt(item, mv.lan, j, at, ms);
    if (token.current !== my) return;

    if (j.kind === 'wrong') {
      return setTurn({
        ...t,
        phase: 'wrong',
        shapes: [arrow(mv.lan, 'red'), ...(j.best ? [arrow(j.best, 'green')] : [])],
        wrong: { san: mv.san, j, label },
      });
    }
    const log: LogEntry[] = [...t.log, { mine: true, label, san: mv.san, j }];
    const after: Turn = { ...t, fen: mv.after, lastMove: mv.lan, log, shapes: j.kind === 'good' && j.best ? [arrow(j.best, 'green')] : [] };
    if (!s.continueLine || t.step >= lineLength) {
      setTurn({ ...after, phase: first ? 'right' : 'done' });
      if (s.mode === 'speed') {
        await wait(j.kind === 'best' ? 350 : 1000);
        if (token.current === my) next();
      }
      return;
    }
    setTurn({ ...after, phase: 'thinking' });
    const reply = await opponentReply(mv.after);
    if (token.current !== my) return;
    if (!reply) return setTurn({ ...after, phase: 'done' });
    await wait(300);
    if (token.current !== my) return;
    const c2 = new Chess(mv.after);
    applyUci(c2, reply.uci);
    setTurn({
      fen: c2.fen(),
      step: t.step + 1,
      phase: c2.isGameOver() ? 'done' : 'move',
      lastMove: reply.uci,
      shapes: [],
      log: [...log, { mine: false, label: moveLabel(mv.after), san: reply.san, reply }],
      shownAt: Date.now(),
    });
  }

  // "Drill this" from the mistakes list or the key insight.
  useEffect(() => {
    if (active && drillRequest.value) {
      const { groups, mode } = drillRequest.value;
      drillRequest.value = null;
      begin(mode, groups.map((group) => ({ group, isNew: false })), 'picked');
    }
  }, [active, drillRequest.value]);

  // The board was hidden while another tab was open.
  useEffect(() => {
    if (active) requestAnimationFrame(() => api.current?.redrawAll());
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const phase = T.current?.phase;
      if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') && (phase === 'right' || phase === 'wrong' || phase === 'done')) {
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const s = S.current;
  const t = T.current;
  const item = s && t ? s.items[s.index] : null;

  const config = useMemo<Config | null>(() => {
    if (!t || !item) return null;
    const chess = new Chess(t.fen);
    const canMove = t.phase === 'move';
    const color = item.group.color;
    return {
      fen: t.fen,
      orientation: color,
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      lastMove: lastMoveOf(t.lastMove),
      check: chess.inCheck(),
      movable: { free: false, color: canMove ? color : undefined, dests: canMove ? dests(chess) : new Map(), showDests: true, events: { after: (o, d) => void onMove(o, d) } },
      premovable: { enabled: false },
      animation: { enabled: true, duration: 200 },
      drawable: { enabled: true, visible: true, autoShapes: t.shapes },
    };
  }, [t]);

  // ---- Start screen ----
  if (!s) {
    const nextDue = [...cards.value.values()].filter((c) => set.some((g) => g.key === c.key)).sort((a, b) => a.card.due.getTime() - b.card.due.getTime())[0];
    const fresh = queue.filter((q) => q.isNew).length;
    return (
      <section class={active ? '' : 'hidden'}>
        <FilterBar />
        <div class="toolbar">
          <label>
            Set{' '}
            <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as SetKind)}>
              {(Object.keys(SET_LABELS) as SetKind[]).map((k) => (
                <option value={k}>
                  {SET_LABELS[k]} ({drillSet(ranked.value, k).length})
                </option>
              ))}
            </select>
          </label>
        </div>
        {set.length === 0 ? (
          <p class="empty">No positions in this set yet. They appear once your games are analysed; try a bigger set or looser filters.</p>
        ) : (
          <div class="drill-modes">
            <div class="mode-card">
              <h3>Recall pass</h3>
              <p>
                Today's spaced-repetition queue: <strong>{queue.length - fresh} due</strong>, {plural(fresh, 'new position')}.
                Each position is graded on your first try and scheduled with FSRS; misses come back before the session ends.
              </p>
              {queue.length === 0 && nextDue && <p class="muted">Nothing due. Next review {day(nextDue.card.due.getTime())}.</p>}
              <button class="primary" disabled={!queue.length} onClick={() => begin('recall', queue, kind)}>
                Start recall ({queue.length})
              </button>
            </div>
            <div class="mode-card">
              <h3>Speed run</h3>
              <p>
                Every position in the set, as fast as you can. Right answers move straight on. Speed runs don't change your
                review schedule.
              </p>
              <label class="check">
                <input type="checkbox" checked={shuffleOn} onChange={() => (setShuffle(!shuffleOn), writePref('shuffle', !shuffleOn))} />
                Shuffle
              </label>
              <label class="check">
                <input type="checkbox" checked={speedLine} onChange={() => (setSpeedLine(!speedLine), writePref('speedLine', !speedLine))} />
                Play on after a right answer
              </label>
              <button class="primary" onClick={() => begin('speed', (shuffleOn ? shuffle(set) : set).map((group) => ({ group, isNew: false })), kind, shuffleOn)}>
                Run all {set.length}
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  // ---- Summary ----
  if (!t || !item) {
    const results = [...s.firstTry];
    const right = results.filter(([, ok]) => ok).length;
    const misses = s.items.filter((it, i) => s.items.findIndex((x) => x.group.key === it.group.key) === i && s.firstTry.get(it.group.key) === false);
    return (
      <section class={active ? 'summary' : 'summary hidden'}>
        <h2>{s.mode === 'recall' ? 'Recall pass done' : s.mode === 'speed' ? 'Run complete' : 'Done'}</h2>
        <p class="big">
          {right} / {results.length} right first time ({results.length ? percent(right / results.length) : '–'}) in{' '}
          {duration((s.finishedAt ?? Date.now()) - s.startedAt)}
        </p>
        {misses.length > 0 && (
          <>
            <h3>Missed</h3>
            <ul class="misses">
              {misses.map(({ group: g }) => (
                <li>
                  {formatLine(g.occurrences[0].game.moves.slice(0, g.occurrences[0].move.ply))} — best {g.bestSan}
                </li>
              ))}
            </ul>
          </>
        )}
        <div class="actions">
          {s.mode === 'speed' && (
            <>
              <button class="primary" onClick={() => begin('speed', (shuffleOn ? shuffle(set) : set).map((group) => ({ group, isNew: false })), kind, shuffleOn)}>
                Run the whole set again
              </button>
              {misses.length > 0 && <button onClick={() => begin('speed', shuffleOn ? shuffle(misses) : misses, 'misses', shuffleOn)}>Run the misses</button>}
              {queue.length > 0 && <button onClick={() => begin('recall', queue, kind)}>Recall pass ({queue.length})</button>}
            </>
          )}
          <button onClick={close}>Back</button>
        </div>
      </section>
    );
  }

  // ---- A position ----
  const g = item.group;
  const firstOcc = g.occurrences[0];
  const line = firstOcc.game.moves.slice(0, firstOcc.move.ply);
  const opening = classifyOpening(line);
  const total = s.items.length;
  const modeName = s.mode === 'recall' ? 'Recall' : s.mode === 'speed' ? 'Speed run' : 'Practice';

  return (
    <section class={active ? 'drill' : 'drill hidden'}>
      <div class="drill-board">{config && <Board config={config} onApi={(a) => (api.current = a)} />}</div>
      <div class="drill-panel">
        <div class="drill-head">
          <span>
            {modeName} · {Math.min(s.index + 1, total)} of {total}
            {item.isNew && <span class="badge">new</span>}
          </span>
          <button class="small" onClick={stop}>
            End
          </button>
        </div>
        <div class="progress">
          <div class="progress-fill" style={{ width: `${(s.index / total) * 100}%` }} />
        </div>
        <p class="muted">{opening?.name ?? 'Out of book'}</p>
        <p class="line">{line.length ? formatLine(line) : 'Starting position'}</p>
        <Prompt t={t} color={g.color} />
        {t.log.length > 0 && (
          <ol class="line-log">
            {t.log.map((e) =>
              e.mine ? (
                <li class={e.j.kind === 'best' ? 'good' : 'ok'}>
                  ✓ {e.label}
                  {e.san}
                  {e.j.kind === 'good' && e.j.bestSan && (
                    <span class="muted">
                      {' '}
                      fine too; engine prefers {e.j.bestSan} ({signedPawns(-e.j.loss)})
                    </span>
                  )}
                </li>
              ) : (
                <li class="reply">
                  {e.label}
                  {e.san}{' '}
                  <span class="muted">
                    {e.reply.source === 'games'
                      ? `your opponents' choice ${e.reply.count} of ${e.reply.total} times`
                      : 'engine reply (no opponent of yours reached this)'}
                  </span>
                </li>
              ),
            )}
          </ol>
        )}
        {t.phase === 'wrong' && t.wrong && <WrongFeedback g={g} w={t.wrong} step={t.step} />}
        {(t.phase === 'right' || t.phase === 'wrong' || t.phase === 'done') && (
          <button class="primary next" onClick={next}>
            Next <kbd>Space</kbd>
          </button>
        )}
      </div>
    </section>
  );
}

function Prompt({ t, color }: { t: Turn; color: 'white' | 'black' }) {
  let text: ComponentChildren;
  if (t.phase === 'thinking') text = 'Checking…';
  else if (t.phase === 'move') text = t.step === 0 ? `You're ${color}. Find the best move.` : 'Your move again.';
  else if (t.phase === 'right') text = <span class="good">Right.</span>;
  else if (t.phase === 'done') text = <span class="good">Line complete.</span>;
  else text = null;
  return text ? <p class="prompt">{text}</p> : null;
}

function WrongFeedback({ g, w, step }: { g: MistakeGroup; w: { san: string; j: Judgement; label: string }; step: number }) {
  return (
    <div class="feedback wrong">
      <p>
        <span class="bad">
          ✗ {w.label}
          {w.san}
        </span>{' '}
        — best is{' '}
        <span class="good">
          {w.label}
          {w.j.bestSan ?? '?'}
        </span>
      </p>
      <p>
        Evaluation {signedPawns(w.j.before)} → {signedPawns(w.j.after)} <strong>(−{pawns(w.j.loss)})</strong>
      </p>
      {step === 0 && (
        <>
          <p class="muted">
            In your games: wrong {g.occurrences.length} of {g.reached} times here.
          </p>
          <ul class="games">
            {g.occurrences.map((o) => (
              <li>
                <a href={o.game.url} target="_blank" rel="noopener">
                  {gameLabel(o.game)}
                </a>{' '}
                <span class="muted">played {o.move.san}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
