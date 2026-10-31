import { analysisState, pauseAnalysis, pendingGames, startAnalysis } from '../analysis';
import { analyses, games, syncStatus } from '../state';
import { duration, plural } from './format';

/** Sync and background-analysis progress, always visible. */
export function StatusBar() {
  const s = analysisState.value;
  const sync = syncStatus.value;
  void analyses.value;
  void games.value;
  const left = s.running ? s.gamesLeft : pendingGames();
  const elapsed = Date.now() - s.startedAt;
  const eta = s.running && s.done > 20 && s.total > s.done ? (elapsed / s.done) * (s.total - s.done) : null;
  const pct = s.total ? (s.done / s.total) * 100 : 0;

  return (
    <div class="status">
      {sync.running && <div class="status-line">Importing: {sync.message}</div>}
      {sync.error && <div class="status-line error">Import failed: {sync.error}</div>}
      {s.running ? (
        <div class="status-line">
          <div class="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div class="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span>
            {s.phase}
            {s.total > 0 && ` ${s.done.toLocaleString()} / ${s.total.toLocaleString()} positions`}
            {left > 0 && ` · ${plural(left, 'game')} left`}
            {eta !== null && ` · about ${duration(eta)} to go`}
          </span>
          <button class="small" onClick={pauseAnalysis}>
            Pause
          </button>
        </div>
      ) : left > 0 && !sync.running ? (
        <div class="status-line">
          <span>{plural(left, 'game')} not analysed yet.</span>
          <button class="small" onClick={() => void startAnalysis()}>
            {s.phase === 'Paused' ? 'Resume' : 'Analyse'}
          </button>
        </div>
      ) : null}
      {s.error && <div class="status-line error">Analysis stopped: {s.error}</div>}
    </div>
  );
}
