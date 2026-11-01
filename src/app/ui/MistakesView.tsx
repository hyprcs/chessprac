import { useState } from 'preact/hooks';
import type { MistakeGroup } from '../../core/mistakes';
import { classifyOpening } from '../../core/openings';
import { formatLine, moveNumberLabel } from '../../core/position';
import { analyses, filteredGames, ranked, settings, updateSettings } from '../state';
import { startAnalysis } from '../analysis';
import { FilterBar } from './Filters';
import { MiniBoard, arrow } from './Board';
import { SITE_NAMES, gameLabel, pawns, plural } from './format';
import { practise } from './drill-request';
import { InsightCard } from './InsightCard';

const PAGE = 20;

export function ThresholdControl() {
  const t = settings.value.thresholdCp;
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? t;
  return (
    <label class="threshold">
      Flag moves losing more than <strong>{pawns(shown)}</strong> pawns
      <input
        type="range"
        min={30}
        max={300}
        step={10}
        value={shown}
        onInput={(e) => setDraft(Number((e.target as HTMLInputElement).value))}
        onChange={async (e) => {
          await updateSettings({ thresholdCp: Number((e.target as HTMLInputElement).value) });
          setDraft(null);
          void startAnalysis(); // fills in best moves for newly flagged positions
        }}
      />
    </label>
  );
}

export function MistakesView() {
  const [recurringOnly, setRecurringOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const all = ranked.value;
  const list = recurringOnly ? all.filter((g) => g.occurrences.length >= 2) : all;
  const analysed = filteredGames.value.filter((g) => analyses.value.has(g.id)).length;

  return (
    <section>
      <InsightCard />
      <FilterBar />
      <div class="toolbar">
        <ThresholdControl />
        <label class="check">
          <input type="checkbox" checked={recurringOnly} onChange={() => setRecurringOnly(!recurringOnly)} />
          Only positions I got wrong more than once
        </label>
      </div>
      <p class="muted">
        {plural(list.length, 'position')} from {plural(analysed, 'analysed game')}, ranked by times wrong × average loss.
      </p>
      {list.length === 0 && (
        <p class="empty">
          {analysed === 0
            ? 'Nothing analysed yet. Results appear here as the engine works through your games.'
            : recurringOnly
              ? 'No position has gone wrong more than once with these filters. Untick the box to see one-off mistakes.'
              : 'No mistakes over the threshold with these filters.'}
        </p>
      )}
      <ol class="mistakes">
        {list.slice(0, shown).map((g, i) => (
          <MistakeCard key={g.key} group={g} rank={i + 1} />
        ))}
      </ol>
      {list.length > shown && (
        <button onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>
      )}
    </section>
  );
}

function MistakeCard({ group: g, rank }: { group: MistakeGroup; rank: number }) {
  const [open, setOpen] = useState(false);
  const first = g.occurrences[0];
  const ply = first.move.ply;
  const line = first.game.moves.slice(0, ply);
  const opening = classifyOpening(line);
  const wrong = new Map<string, { n: number; uci: string }>();
  for (const o of g.occurrences) {
    const w = wrong.get(o.move.san) ?? { n: 0, uci: o.move.uci };
    w.n++;
    wrong.set(o.move.san, w);
  }
  const mostWrong = [...wrong.values()].sort((a, b) => b.n - a.n)[0];
  const others = [...g.played].filter(([san]) => !wrong.has(san));
  const orders = new Set(g.occurrences.map((o) => o.game.moves.slice(0, o.move.ply).join(' '))).size;
  const label = moveNumberLabel(ply);

  return (
    <li class="mistake">
      <MiniBoard
        fen={g.fen}
        color={g.color}
        shapes={[arrow(mostWrong.uci, 'red'), ...(g.best ? [arrow(g.best, 'green')] : [])]}
      />
      <div class="mistake-body">
        <h3>
          <span class="rank">{rank}</span> {opening?.name ?? 'Out of book'}
        </h3>
        <p class="line">
          {line.length ? formatLine(line) : 'Starting position'}
          {orders > 1 && <span class="muted"> · reached by {orders} move orders</span>}
        </p>
        <p>
          You played{' '}
          {[...wrong].map(([san, w], i) => (
            <>
              {i > 0 && ', '}
              <span class="bad">
                {label}
                {san}
              </span>
              {w.n > 1 && ` ×${w.n}`}
            </>
          ))}
          {g.bestSan && (
            <>
              ; best is{' '}
              <span class="good">
                {label}
                {g.bestSan}
              </span>
            </>
          )}
          .
        </p>
        <p class="stats">
          <span>
            Wrong <strong>{g.occurrences.length}</strong> of {g.reached}
          </span>
          <span>
            avg <strong>−{pawns(g.avgLoss)}</strong>
          </span>
          <span>{[...new Set(g.occurrences.map((o) => SITE_NAMES[o.game.site]))].join(' + ')}</span>
          {others.length > 0 && <span class="muted">also played {others.map(([s, n]) => `${s} ×${n}`).join(', ')}</span>}
        </p>
        <div class="actions">
          <button class="primary small" onClick={() => practise([g])} disabled={!g.best}>
            Drill this
          </button>
          <button class="small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide games' : `Games (${g.occurrences.length})`}
          </button>
        </div>
        {open && (
          <ul class="games">
            {g.occurrences.map((o) => (
              <li>
                <a href={o.game.url} target="_blank" rel="noopener">
                  {gameLabel(o.game)}
                </a>{' '}
                <span class="muted">
                  {label}
                  {o.move.san} −{pawns(o.move.loss)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
