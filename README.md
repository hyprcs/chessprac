# chessprac

Pulls your chess.com and Lichess games into one profile, finds the positions in the first 20 moves where you keep going wrong, and drills them until the right move is automatic.

A static site (Vite + TypeScript + Preact). Everything runs in your browser: games, analysis and review schedule live in IndexedDB, and Stockfish runs in Web Workers.

## Using it

1. **Create a profile and link an account.** Use chess.com or Lichess, and choose how far back to import. Link the other site, or more accounts, later; their games merge into the same profile.
2. **Analysis runs in the background.** A progress bar shows how far it has got. Every position where you were to move in the first 20 moves is scored, and a move is flagged when it loses more than 0.8 pawns against the best move (adjustable). It saves as it goes, so closing the tab only pauses it. Games Lichess has already analysed reuse Lichess's evals. For each flagged move it then searches the position after it for two lines: the opponent's best line (how the move is punished) and the runner-up reply (whether that punishment was the only good move). Imports keep each move's clock time and the site's accuracy score where it has one; accounts imported before this was added are fetched again once on the next sync.
3. **Mistakes.** Positions are grouped by FEN, so the same error on either site, or after a different move order, counts once. They're ranked by times wrong × average loss. Filter by site, colour and time control.
4. **Openings.** Your score per opening and variation, named the same way for both sites.
5. **Drill.**
   - *Recall pass:* today's FSRS queue, graded on your first try.
   - *Speed run:* the whole set, as fast as you can. It doesn't touch the schedule.
   - *After a right answer:* the drill plays the reply your opponents most often chose (falling back to the engine) and continues for a few moves.
   - *After a wrong answer:* it shows the best move, the eval drop, and links to the games where you went wrong.
   - Every try in every mode is logged with its move and answer time, along with each session, so speed-run cycles and review history can be studied later.
6. **Export your profile** from the Profile tab now and then. If browser data is cleared, importing the file restores everything, drill history included.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # typecheck + production build in dist/
```

### Deploying to GitHub Pages

Push to `main` on GitHub, then set **Settings → Pages → Source** to **GitHub Actions**. `.github/workflows/deploy.yml` tests, builds and publishes `dist/`. Asset paths are relative, so the site works at `https://<you>.github.io/<repo>/`. The engine is the single-threaded build, which needs no cross-origin-isolation headers, so plain Pages hosting is enough.

### Command-line report

The same pipeline runs in Node, for checking an import or doing the first big analysis faster:

```bash
npm run report -- --profile me --chesscom <user> --lichess <user> --since 2026-02-01 --lichess-since all
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--chesscom`, `--lichess` | | Accounts to link (repeatable). |
| `--since` | all history | First import only: games finished on or after this date. |
| `--lichess-since` | `--since` | Separate window for Lichess; `all` for everything. |
| `--threshold` | 80 | Flag a move that loses more than this many centipawns versus the best move. |
| `--depth` | 16 | Stockfish search depth. |
| `--workers` | cores − 2 | Parallel engine processes. |

It writes `.cache/<profile>.json` in the app's export format (use **Import profile file** in the app to load it with the analysis already done), plus a plain-text report in `.cache/<profile>-report.txt`.

## How it works

- **Import.** chess.com: the archive list, then each monthly archive. Lichess: one streamed NDJSON request to `/api/games/user/{username}`, oldest first, one request at a time, with a minute's pause on 429. Variants and custom starting positions are skipped. Games are keyed by site and game id, so re-importing never duplicates. Syncs only fetch what's new.
- **Speed.** Every game is bucketed by base + 40 × increment (bullet < 3 min, blitz < 8, rapid < 25, then classical), not by the site's label. Ratings are shown per site and never combined.
- **Openings.** Both sites' games are classified from their moves with the [Lichess opening book](https://github.com/lichess-org/chess-openings) (CC0).
- **Analysis.** Stockfish 19 lite (WASM, single-threaded) evaluates the positions before and after each of your moves. Loss = eval before − eval after, from your side, capped at ±10 pawns.

## Browser access

Both APIs send `Access-Control-Allow-Origin: *` and answer requests from a browser page, so no proxy is needed. They do reject requests that look like scripts: chess.com's Cloudflare returns 403 to curl's default User-Agent, and Lichess returns 404. So command-line tools must send a descriptive User-Agent, which the report script does.

## Licences

Stockfish is GPL-3.0. The site ships its WASM build (with its licence at `engine/COPYING.txt`) and links to the source in the footer. If you publish the site, keep it GPL-compatible. The opening book is CC0.
