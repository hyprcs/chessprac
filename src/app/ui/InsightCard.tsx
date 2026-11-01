import { useState } from 'preact/hooks';
import type { FollowUp, InsightChart, Metric, ShownInsight } from '../../core/insights';
import { nextRotation } from '../../core/insights';
import { rankMistakes } from '../../core/mistakes';
import { analysisState, pendingGames } from '../analysis';
import { insightProgress, insightShown, markInsightSeen } from '../insight';
import { analyses, games, lookup, settings } from '../state';
import { MiniBoard, arrow } from './Board';
import { practise } from './drill-request';
import { day, plural } from './format';

/** The key insight, at the top of the home tab: open while it's new, one line once read. */
export function InsightCard() {
  const shown = insightShown.value;
  if (!shown) return <InsightPending />;
  return <Shown key={shown.shownAt} shown={shown} />;
}

function Shown({ shown }: { shown: ShownInsight }) {
  const isNew = !shown.seenAt;
  const [open, setOpen] = useState(isNew);
  const i = shown.insight;
  const next = nextRotation(shown, Date.now(), games.value);

  const drill = () => {
    const byKey = new Map(rankMistakes(games.value, analyses.value, settings.value.thresholdCp, lookup).map((g) => [g.key, g]));
    const groups = (i.drill ?? []).map((k) => byKey.get(k)).filter((g) => !!g?.best);
    if (groups.length) practise(groups as NonNullable<(typeof groups)[number]>[], i.drillMode);
  };

  return (
    <section class={isNew ? 'insight new' : 'insight'} aria-labelledby="insight-title">
      <div class="insight-head">
        <span class="eyebrow">
          Your key insight{isNew && <span class="badge">New</span>}
        </span>
        <span class="muted">
          From {plural(i.games, 'game')} · {day(shown.shownAt)} · next one in{' '}
          {next.days <= 0 || next.games <= 0 ? 'your next visit' : `${plural(next.days, 'day')} or ${plural(next.games, 'game')}, whichever comes first`}
        </span>
      </div>
      <h2 id="insight-title">{i.title}</h2>
      {open ? (
        <>
          <div class="insight-main">
            {i.position && (
              <MiniBoard
                fen={i.position.fen}
                color={i.position.color}
                shapes={[arrow(i.position.wrong, 'red'), ...(i.position.best ? [arrow(i.position.best, 'green')] : [])]}
              />
            )}
            <div class="insight-body">
              {i.body.map((p) => (
                <p>{p}</p>
              ))}
              {i.chart && <Chart chart={i.chart} />}
              <p class="advice">
                <strong>What to do:</strong> {i.advice}
              </p>
              <div class="actions">
                {!!i.drill?.length && (
                  <button class="primary small" onClick={drill}>
                    {i.drillMode === 'speed' ? 'Speed-run' : 'Drill'} {i.drill.length === 1 ? 'this position' : `these ${i.drill.length} positions`}
                  </button>
                )}
                {isNew ? (
                  <button class="small" onClick={() => void markInsightSeen().then(() => setOpen(false))}>
                    Got it
                  </button>
                ) : (
                  <button class="small" onClick={() => setOpen(false)} aria-expanded="true">
                    Hide
                  </button>
                )}
              </div>
            </div>
          </div>
          {shown.followUp && <FollowUpLine f={shown.followUp} />}
        </>
      ) : (
        <button class="small" onClick={() => setOpen(true)} aria-expanded="false">
          Show
        </button>
      )}
    </section>
  );
}

/** Before the first insight: what it's waiting for. */
function InsightPending() {
  const { analysed, needed } = insightProgress.value;
  const left = pendingGames();
  if (!games.value.length) return null;
  const waiting = left > 0 || analysisState.value.running;
  return (
    <section class="insight pending">
      <span class="eyebrow">Your key insight</span>
      {analysed < needed ? (
        <p>
          It appears once {needed} games are analysed ({analysed} so far). It's one finding about your play, chosen from your games
          against your own opponents, and it changes every month or 150 games.
        </p>
      ) : waiting ? (
        <p>It appears when the analysis finishes ({plural(left, 'game')} to go), so it's drawn from all your games.</p>
      ) : (
        <p>
          No finding is clear enough yet. Each one has to hold up statistically before it's shown, so more games will bring the
          first one.
        </p>
      )}
    </section>
  );
}

function Chart({ chart }: { chart: InsightChart }) {
  if (chart.kind === 'diverging') {
    const max = Math.max(...chart.rows.map((r) => Math.abs(r.value)), 1);
    return (
      <figure class="chart">
        <figcaption>{chart.caption}</figcaption>
        <div class="chart-rows">
          {chart.rows.map((r) => (
            <div class={r.highlight ? 'chart-row on' : 'chart-row'}>
              <span class="chart-label">Moves {r.label}</span>
              <span class="diverge">
                <span
                  class={r.value < 0 ? 'bar neg' : 'bar pos'}
                  style={{ width: `${(Math.abs(r.value) / max) * 50}%`, [r.value < 0 ? 'right' : 'left']: '50%' }}
                />
              </span>
              <span class="chart-value">
                {r.value > 0 ? '+' : r.value < 0 ? '−' : ''}
                {Math.abs(r.value).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </figure>
    );
  }
  return (
    <figure class="chart">
      <figcaption>{chart.caption}</figcaption>
      <div class="legend">
        <span>
          <i class="swatch a" /> {chart.series[0]}
        </span>
        <span>
          <i class="swatch b" /> {chart.series[1]}
        </span>
      </div>
      <div class="chart-rows">
        {chart.rows.map((r) => (
          <div class="chart-row paired">
            <span class="chart-label">{r.label}</span>
            <span class="pair">
              <span class="track" title={`${plural(r.na, 'game')}`}>
                <span class="bar a" style={{ width: `${r.a * 100}%` }} />
                <span class="pair-value">{r.na ? `${Math.round(r.a * 100)}%` : '–'}</span>
              </span>
              <span class="track" title={`${plural(r.nb, 'game')}`}>
                <span class="bar b" style={{ width: `${r.b * 100}%` }} />
                <span class="pair-value">{r.nb ? `${Math.round(r.b * 100)}%` : '–'}</span>
              </span>
            </span>
          </div>
        ))}
      </div>
    </figure>
  );
}

const formatMetric = (m: Metric, v: number) => (m.unit === '%' ? `${Math.round(v)}%` : v.toFixed(1));

function FollowUpLine({ f }: { f: FollowUp }) {
  const was = formatMetric(f.metric, f.metric.value);
  if (f.now === null)
    return (
      <p class="follow-up muted">
        Last time: “{f.title}”. Too few games since ({f.games}) to say whether it changed.
      </p>
    );
  const change = f.now - f.metric.value;
  const small = Math.abs(change) < Math.max(1, Math.abs(f.metric.value) * 0.15);
  const better = f.metric.lowerIsBetter ? change < 0 : change > 0;
  return (
    <p class="follow-up">
      Last time: “{f.title}”. {f.metric.label}: {was} then, {formatMetric(f.metric, f.now)} in the {plural(f.games, 'game')} since.{' '}
      <strong class={small ? '' : better ? 'good' : 'bad'}>{small ? 'About the same.' : better ? 'Better.' : 'Worse.'}</strong>
    </p>
  );
}
