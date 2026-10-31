/**
 * Command-line check of the import and analysis pipeline, using the same core
 * code as the web app. Writes a profile file the app can import, so the
 * engine work done here isn't repeated in the browser.
 *
 *   npm run report -- --chesscom hypriva --lichess hypriva --since 2026-08-01 --lichess-since all
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import type { Account, GameAnalysis, GameRecord, Site } from '../src/core/types';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { PROFILE_FORMAT, PROFILE_VERSION, parseProfileFile, type ProfileFile } from '../src/core/profile-file';
import { SITE_NAMES, syncAccount } from '../src/core/import/sync';
import type { SkipReason } from '../src/core/import/common';
import { analyseGame, bestMoveJobs, engineJobs } from '../src/core/analysis/analyse';
import type { EvalJob } from '../src/core/analysis/engine';
import { rankMistakes, type MistakeGroup } from '../src/core/mistakes';
import { formatLine, moveNumberLabel } from '../src/core/position';
import { classifyOpening } from '../src/core/openings';
import { formatTimeControl } from '../src/core/timecontrol';
import { nodePool } from './node-engine';

const USER_AGENT = 'chessprac/0.1 (personal opening-mistake trainer; command-line import check)';

const { values: args } = parseArgs({
  options: {
    profile: { type: 'string', default: 'default' },
    chesscom: { type: 'string', multiple: true, default: [] },
    lichess: { type: 'string', multiple: true, default: [] },
    since: { type: 'string' },
    'lichess-since': { type: 'string' },
    threshold: { type: 'string', default: String(DEFAULT_SETTINGS.thresholdCp) },
    depth: { type: 'string', default: String(DEFAULT_SETTINGS.depth) },
    workers: { type: 'string', default: String(Math.max(1, cpus().length - 2)) },
    top: { type: 'string', default: '10' },
  },
});

const threshold = Number(args.threshold);
const depth = Number(args.depth);
const maxPly = DEFAULT_SETTINGS.maxPly;
const parseDate = (s: string | undefined) => (s && s !== 'all' ? Date.parse(s + 'T00:00:00Z') : undefined);
const sinceBySite: Record<Site, number | undefined> = {
  chesscom: parseDate(args.since),
  lichess: parseDate(args['lichess-since'] ?? args.since),
};

const cacheFile = `.cache/${args.profile}.json`;
const log = (msg: string) => process.stderr.write(msg + '\n');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pawns = (cp: number) => (cp / 100).toFixed(2);

function loadFile(): ProfileFile {
  if (existsSync(cacheFile)) return parseProfileFile(readFileSync(cacheFile, 'utf8'));
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: 0,
    profile: { id: args.profile!, name: args.profile!, accounts: [], settings: { ...DEFAULT_SETTINGS }, createdAt: Date.now() },
    games: [],
    analyses: [],
    evals: {},
    cards: [],
  };
}

async function main() {
  const file = loadFile();
  const { profile } = file;
  const wanted: [Site, string][] = [
    ...args.chesscom!.map((u) => ['chesscom', u.toLowerCase()] as [Site, string]),
    ...args.lichess!.map((u) => ['lichess', u.toLowerCase()] as [Site, string]),
  ];
  for (const [site, username] of wanted)
    if (!profile.accounts.some((a) => a.site === site && a.username === username))
      profile.accounts.push({ site, username, sync: {} });

  const games = new Map(file.games.map((g) => [g.id, g]));
  const evals = new Map(Object.entries(file.evals));
  const lookup = (k: string) => evals.get(k);
  const save = (analyses?: GameAnalysis[]) => {
    mkdirSync('.cache', { recursive: true });
    file.exportedAt = Date.now();
    file.games = [...games.values()];
    file.evals = Object.fromEntries(evals);
    if (analyses) file.analyses = analyses;
    writeFileSync(cacheFile, JSON.stringify(file));
  };

  // 1. Import
  const skipped = new Map<string, number>();
  const accounts: Account[] = [];
  for (const acc of profile.accounts) {
    let added = 0;
    const updated = await syncAccount(acc, {
      since: sinceBySite[acc.site],
      userAgent: USER_AGENT,
      onGame: (g) => {
        if (!games.has(g.id)) added++;
        games.set(g.id, g);
      },
      onSkip: (reason: SkipReason) => {
        const k = `${acc.site}|${reason}`;
        skipped.set(k, (skipped.get(k) ?? 0) + 1);
      },
      onProgress: log,
      onWait: (ms, why) => log(`  waiting ${Math.round(ms / 1000)}s (${why})`),
    });
    log(`${SITE_NAMES[acc.site]} ${acc.username}: ${added} new games`);
    accounts.push(updated);
  }
  profile.accounts = accounts;
  save();

  const inWindow = [...games.values()]
    .filter((g) => g.playedAt >= (sinceBySite[g.site] ?? 0))
    .sort((a, b) => a.playedAt - b.playedAt);

  // 2. Analyse
  const workers = Number(args.workers);
  const pool = await nodePool(workers);
  const runJobs = async (jobs: EvalJob[], label: string) => {
    if (!jobs.length) return;
    const t0 = Date.now();
    let lastPct = -1;
    await pool.evaluateAll(jobs, depth, (job, ev, done, total) => {
      evals.set(job.key, ev);
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        log(`  ${label}: ${done}/${total} positions (${pct}%), ${Math.round((Date.now() - t0) / 1000)}s`);
      }
      if (done % 1000 === 0) save();
    });
  };
  const jobs = engineJobs(inWindow, maxPly, depth, lookup);
  log(`Analysing ${inWindow.length} games: ${jobs.length} positions need the engine (depth ${depth}, ${workers} workers)`);
  await runJobs(jobs, 'engine');
  const analyse = () =>
    inWindow.map((g) => analyseGame(g, maxPly, depth, lookup)).filter((a): a is GameAnalysis => a !== null);
  let analyses = analyse();
  await runJobs(bestMoveJobs(analyses, threshold, lookup), 'best moves');
  analyses = analyse();
  pool.terminate();
  save(analyses);

  // 3. Report
  const byId = new Map(analyses.map((a) => [a.gameId, a]));
  const ranked = rankMistakes(inWindow, byId, threshold, lookup);
  const text = report(inWindow, analyses, ranked, skipped, jobs.length);
  writeFileSync(`.cache/${args.profile}-report.txt`, text);
  process.stdout.write(text);
}

function report(
  games: GameRecord[],
  analyses: GameAnalysis[],
  ranked: MistakeGroup[],
  skipped: Map<string, number>,
  enginePositions: number,
): string {
  const out: string[] = [];
  const p = (s = '') => out.push(s);
  const count = <T>(xs: T[], f: (x: T) => string) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  };

  p('IMPORT');
  for (const site of ['chesscom', 'lichess'] as Site[]) {
    const gs = games.filter((g) => g.site === site);
    const since = sinceBySite[site];
    const window = since ? `since ${day(since)}` : 'all history';
    p(`  ${SITE_NAMES[site]}: ${gs.length} games (${window}${gs.length ? `; ${day(gs[0].playedAt)} to ${day(gs[gs.length - 1].playedAt)}` : ''})`);
    if (!gs.length) continue;
    p(`    by our speed bucket: ${count(gs, (g) => g.speed)}`);
    p(`    as: ${count(gs, (g) => g.color)}   results: ${count(gs, (g) => g.result)}`);
    const relabelled = gs.filter((g) => g.siteSpeed !== g.speed && !(g.siteSpeed === 'daily' && g.speed === 'correspondence'));
    if (relabelled.length)
      p(`    bucketed differently from the site's label: ${count(relabelled, (g) => `${formatTimeControl(g.timeControl)} (${g.siteSpeed} -> ${g.speed})`)}`);
    const skips = [...skipped].filter(([k]) => k.startsWith(site + '|')).map(([k, n]) => `${n} ${k.split('|')[1]}`);
    p(`    skipped: ${skips.length ? skips.join(', ') : 'none'}`);
    if (site === 'lichess') p(`    already analysed by Lichess (evals reused, not re-run): ${gs.filter((g) => g.lichessEvals).length}`);
  }
  p(`  Total: ${games.length} games`);
  p();

  const scored = analyses.reduce((n, a) => n + a.moves.length, 0);
  const flagged = analyses.reduce((n, a) => n + a.moves.filter((m) => m.loss > threshold).length, 0);
  p('ANALYSIS');
  p(`  Stockfish 19 lite (WASM, same build as the web app), depth ${depth}; ${enginePositions} new positions evaluated this run`);
  p(`  ${scored} of my moves scored (first ${maxPly / 2} moves of each game), ${flagged} flagged for losing more than ${pawns(threshold)} pawns`);
  p(`  ${ranked.length} distinct positions with a flagged move; ${ranked.filter((g) => g.occurrences.length >= 2).length} of them recurring (wrong 2+ times)`);
  p();

  const recurring = ranked.filter((g) => g.occurrences.length >= 2);
  const top = recurring.slice(0, Number(args.top));
  p(`TOP ${top.length} RECURRING MISTAKES (same position, wrong 2+ times; ranked by times wrong x average loss)`);
  top.forEach((g, i) => {
    const o = g.occurrences[0];
    const ply = o.move.ply;
    const line = o.game.moves.slice(0, ply);
    const lines = new Set(g.occurrences.map((x) => x.game.moves.slice(0, x.move.ply).join(' ')));
    const opening = classifyOpening(line);
    const wrong = new Map<string, number>();
    for (const x of g.occurrences) wrong.set(x.move.san, (wrong.get(x.move.san) ?? 0) + 1);
    const wrongText = [...wrong].map(([san, n]) => `${moveNumberLabel(ply)}${san} x${n}`).join(', ');
    const others = [...g.played].filter(([san]) => !wrong.has(san)).map(([san, n]) => `${san} x${n}`);
    p();
    p(`${String(i + 1).padStart(2)}. ${opening?.name ?? 'Out of book'} — you are ${g.color}, move ${moveNumberLabel(ply)}`);
    p(`    After ${line.length ? formatLine(line) : 'the start'}${lines.size > 1 ? `  (reached by ${lines.size} different move orders)` : ''}`);
    p(`    You played ${wrongText}; best is ${g.bestSan ? moveNumberLabel(ply) + g.bestSan : '?'}. Average loss ${pawns(g.avgLoss)} pawns`);
    p(`    Wrong ${g.occurrences.length} of ${g.reached} times you had this position${others.length ? ` (other moves you played here: ${others.join(', ')})` : ''}`);
    p(`    Sites: ${count(g.occurrences, (x) => SITE_NAMES[x.game.site])}`);
    for (const x of g.occurrences)
      p(`      ${day(x.game.playedAt)} ${SITE_NAMES[x.game.site].padEnd(9)} ${formatTimeControl(x.game.timeControl).padEnd(5)} -${pawns(x.move.loss)}  ${x.game.url}`);
    p(`    FEN ${g.fen}`);
  });
  if (top.length < Number(args.top)) p(`\n  (only ${top.length} positions went wrong more than once)`);
  p();

  p('ON BOTH SITES');
  const both = top.map((g, i) => [g, i + 1] as const).filter(([g]) => g.sites.length > 1);
  p(both.length ? both.map(([g, n]) => `  #${n} ${g.fen}`).join('\n') : '  None of the top list appeared on both sites.');
  const allBoth = ranked.filter((g) => g.sites.length > 1).length;
  p(`  Across all ${ranked.length} flagged positions, ${allBoth} appeared on both sites.`);
  return out.join('\n') + '\n';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
