# chessprac

Pulls your chess.com and Lichess games into one profile, finds the positions in the first 20 moves where you keep going wrong, and drills them until the right move is automatic.

Status: the import and analysis core is done and checked with a command-line report. The web UI (profiles, drill board, spaced repetition) comes next.

## Command-line report

```bash
npm install
npm run report -- --profile me --chesscom <user> --lichess <user> --since 2026-08-01 --lichess-since all
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--chesscom`, `--lichess` | | Accounts to link (repeatable). |
| `--since` | all history | First import only: games finished on or after this date. |
| `--lichess-since` | `--since` | Separate window for Lichess; `all` for everything. |
| `--threshold` | 80 | Flag a move that loses more than this many centipawns versus the best move. |
| `--depth` | 16 | Stockfish search depth. |
| `--workers` | cores − 2 | Parallel engine processes. |

It writes `.cache/<profile>.json`, a profile file in the app's export format, so the engine work isn't repeated, and `.cache/<profile>-report.txt`. Later runs only fetch new games.

## How it works

- **Import.** chess.com: the archive list, then each monthly archive. Lichess: one streamed NDJSON request to `/api/games/user/{username}`, oldest first, with backoff on 429. Variants and custom starting positions are skipped. Games are keyed by site and game id, so re-importing never duplicates.
- **Speed.** Every game is bucketed by base + 40 × increment (bullet < 3 min, blitz < 8, rapid < 25, then classical), not by the site's label.
- **Openings.** Both sites' games are classified from their moves with the [Lichess opening book](https://github.com/lichess-org/chess-openings) (CC0), so names match across sites.
- **Analysis.** Stockfish 19 lite (WASM, single-threaded) evaluates every position where you were to move in the first 20 moves, plus the position after your move. Loss = eval before − eval after, from your side, capped at ±10 pawns. When Lichess already has computer analysis for a game, its evals are used instead.
- **Matching.** Positions are keyed by FEN without the move counters, so the same mistake on either site, or after a different move order, is one position.
- **Ranking.** Times wrong × average loss.

## Browser access

Both APIs send `Access-Control-Allow-Origin: *` and answer requests from a browser page, so the static site needs no proxy. Both reject requests that look like scripts, though. chess.com's Cloudflare returns 403 to curl's default User-Agent, and Lichess returns 404. Command-line tools must send a descriptive User-Agent, which the report script does.

## Licences

Stockfish is GPL-3.0. The web app will ship the engine's WASM build, so the deployed site has to comply with the GPL: link to its source, and keep the app itself GPL-compatible. The opening book is CC0.
