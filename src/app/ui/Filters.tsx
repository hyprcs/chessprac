import type { Color, Site, Speed } from '../../core/types';
import { filters, games, setFilters } from '../state';
import { SITE_NAMES, SITES, SPEEDS } from './format';

function toggle<T>(list: T[] | undefined, value: T): T[] {
  const cur = list ?? [];
  return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: preact.ComponentChildren }) {
  return (
    <button class={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

/** Site / colour / speed filters shared by every view. Nothing selected in a group means "all". */
export function FilterBar() {
  const f = filters.value;
  const present = new Set(games.value.map((g) => g.speed));
  const sitesPresent = new Set(games.value.map((g) => g.site));
  return (
    <div class="filters">
      {sitesPresent.size > 1 && (
        <div class="chip-group" aria-label="Site">
          {SITES.filter((s) => sitesPresent.has(s)).map((s: Site) => (
            <Chip on={!!f.sites?.includes(s)} onClick={() => setFilters({ ...f, sites: toggle(f.sites, s) })}>
              {SITE_NAMES[s]}
            </Chip>
          ))}
        </div>
      )}
      <div class="chip-group" aria-label="Colour">
        {(['white', 'black'] as Color[]).map((c) => (
          <Chip on={!!f.colors?.includes(c)} onClick={() => setFilters({ ...f, colors: toggle(f.colors, c) })}>
            {c === 'white' ? 'As White' : 'As Black'}
          </Chip>
        ))}
      </div>
      <div class="chip-group" aria-label="Time control">
        {SPEEDS.filter((s) => present.has(s)).map((s: Speed) => (
          <Chip on={!!f.speeds?.includes(s)} onClick={() => setFilters({ ...f, speeds: toggle(f.speeds, s) })}>
            {s[0].toUpperCase() + s.slice(1)}
          </Chip>
        ))}
      </div>
    </div>
  );
}
