import { useState } from 'preact/hooks';
import { scoreByOpening } from '../../core/stats';
import { filteredGames } from '../state';
import { FilterBar } from './Filters';
import { percent, plural } from './format';

export function OpeningsView() {
  const [level, setLevel] = useState<'family' | 'variation'>('variation');
  const [minGames, setMinGames] = useState(3);
  const gs = filteredGames.value;
  const rows = scoreByOpening(gs, level).filter((r) => r.games >= minGames);

  return (
    <section>
      <FilterBar />
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Group by">
          <button class={level === 'family' ? 'on' : ''} onClick={() => setLevel('family')}>
            Openings
          </button>
          <button class={level === 'variation' ? 'on' : ''} onClick={() => setLevel('variation')}>
            Variations
          </button>
        </div>
        <label>
          At least{' '}
          <select value={minGames} onChange={(e) => setMinGames(Number((e.target as HTMLSelectElement).value))}>
            {[1, 3, 5, 10, 20].map((n) => (
              <option value={n}>{plural(n, 'game')}</option>
            ))}
          </select>
        </label>
      </div>
      <p class="muted">
        Your score (win = 1, draw = ½) over {plural(gs.length, 'game')}. Openings are named from the moves with the Lichess
        opening book, so chess.com and Lichess games group together.
      </p>
      {rows.length === 0 ? (
        <p class="empty">No opening has {plural(minGames, 'game')} with these filters.</p>
      ) : (
        <table class="openings">
          <thead>
            <tr>
              <th>Opening</th>
              <th>As</th>
              <th class="num">Games</th>
              <th class="num">W / D / L</th>
              <th class="score-col">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr>
                <td>{r.name}</td>
                <td>{r.color === 'white' ? 'White' : 'Black'}</td>
                <td class="num">{r.games}</td>
                <td class="num muted">
                  {r.wins} / {r.draws} / {r.losses}
                </td>
                <td class="score-col">
                  <div class="score-bar" title={`${percent(r.score)} over ${plural(r.games, 'game')}`}>
                    <div class={r.score < 0.45 ? 'fill low' : r.score > 0.55 ? 'fill high' : 'fill'} style={{ width: percent(r.score) }} />
                    <span>{percent(r.score)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
