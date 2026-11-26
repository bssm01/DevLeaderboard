# DevLeaderboard

A GitHub organization leaderboard. It collects contribution activity for every member of an
organization across **all of its repositories**, ranks them with a composite score, caches the
result in MongoDB, and serves it through a small HTTP API. The read path never talks to GitHub.

The site opens directly on **`MicroClub-USTHB`** at `/leaderboard/MicroClub-USTHB` — no login,
no setup screen. Any other organization can be opened by navigating to
`/leaderboard/<org-login>`.

The repo contains both halves of the product:

| Folder | What it is |
|---|---|
| [`backend/`](backend/) | Express 5 + TypeScript API, MongoDB cache, GitHub collector, cron refreshes |
| [`frontend/`](frontend/) | React 19 + Tailwind v4 single-page app (dark-only) |

## What the app does

- **Opens on the club leaderboard.** `/` redirects to `/leaderboard/MicroClub-USTHB`. The header
  is a plain wordmark; there is no org switcher or search box.
- **Three timeline options** — **This month** (1st of the month, 00:00 UTC → now), **All time**
  (organization creation → now), and a **custom range** picked with From/To date inputs. The
  selection lives in the URL (`?period=month|all|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&page=N`) so
  every view is shareable and bookmarkable.
- **No authentication.** Reads and refreshes are public. Refreshes are rate-limited per IP because
  they spend GitHub quota.
- **Desktop table and mobile cards** with rank, commits, pull requests, reviews, issues and the
  weighted score. The table is paginated (20 per page, server-side `offset`), and uses
  Premier-League-style zones: the top four rows are green, the bottom three are red.
- **Automatic first snapshot.** If a period has never been collected, the page gets a `202`, starts
  the refresh itself, and polls until the snapshot lands.
- **Caching with an explicit escape hatch.** The server serves `month` snapshots for 60 seconds and
  `all`/`custom` snapshots for 24 hours; the **Refresh** button sends `force=1` and always
  recomputes.
- **Praised for its failure behavior:** a stale snapshot stays on screen when GitHub or the API is
  down, with a retry hint and the server's `Retry-After`.
- **Meta panel:** scoring weights, GitHub rate-limit budget and snapshot freshness.

## Stack

**Backend** — Express 5 · TypeScript (ESM) · Mongoose · Node 22+ · GitHub GraphQL API (REST
fallback for member discovery and outside collaborators) · node-cron · zod-validated config.

**Frontend** — Vite 8 · React 19 · TypeScript (strict) · Tailwind CSS v4 (`@theme` tokens) ·
React Router 7 · TanStack Query 5 · lucide-react.

## Quick start

Prerequisites: Node 22+, MongoDB (local or a MongoDB Atlas connection string), and a GitHub token.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # fill in GITHUB_TOKEN (+ DATABASE_* for Atlas)
npm run dev                   # http://localhost:3000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

The backend refreshes `LEADERBOARD_ORGS` (default `MicroClub-USTHB`) at boot, so the first visit
already has a snapshot.

The Vite dev server proxies `/api/*` to `http://localhost:3000`, so the browser never makes a
cross-origin request and the backend needs no CORS headers.

### GitHub token

- **Classic PAT** with `repo` + `read:org` + `read:user` — full member list, private repositories,
  and private contributions.
- **Fine-grained PAT** also works. When it cannot read organization membership, the collector
  automatically falls back to the public member list **plus the contributors of every visible
  repository** (forks included), so a public leaderboard still has real activity. Private
  repositories are counted directly when the token can see them, so private work still ranks even
  without the classic `read:user` scope.

Activity is counted from **every branch** of every visible repository, not just the default branch.
That includes unmerged feature-branch commits, PRs opened or closed/merged in the window, every
submitted review, and issues opened or solved in the window. Commits are deduplicated by SHA, so a
merge that makes the same commit reachable from several branches is counted once.

If a contributor works in a private repository the token cannot access, they cannot appear on the
board. Grant the token access to those repositories, or use a classic PAT with `repo` + `read:user`.

The board counts **only `MicroClub-USTHB` repositories** by default. If club work ever lives in a
personal repository, it can be added explicitly with `LEADERBOARD_EXTRA_REPOS=org=owner/repo`
(comma-separated for several projects); the setting is empty by default. External repositories are
scanned in full — every branch, PR, review and issue — but only for accounts that also contributed
inside the organization in the same period, so an outsider can never enter the board through them.

### Production build

```bash
cd frontend && npm run build    # static assets in frontend/dist/
```

Serve `frontend/dist/` from any static host and make sure `/api` is reverse-proxied to the backend
(the client always calls the relative path `/api/...`).

## Project structure

```
backend/
  app.ts                 Express app (helmet, routes, error handling)
  server.ts              entry point (DB connect, migration, listen, boot refresh, cron)
  routes/                Express routers (leaderboard + refresh rate-limit bucket)
  controllers/           HTTP semantics: validation, status codes, ETag, GitHub→HTTP error mapping
  services/
    leaderboard/         collector → aggregator → sync (single-flight writes, TTL cache)
    github/              typed REST/GraphQL client (timeout, backoff, rate-limit merge)
  models/                Mongoose schemas (LeaderboardSnapshot + migration)
  jobs/                  node-cron scheduler + boot refresh
  middleware/            request logging, error handling
  lib/                   structured JSON logger, bounded-concurrency helper
  config/                zod-validated config, fail-fast at boot

frontend/
  src/app/               router (root → default org), provider stack, layout, 404
  src/features/
    leaderboard/         queries + refresh mutation, timeline selector, table/cards, meta
  src/shared/
    api/                 typed DTOs and the single fetch wrapper (ApiError, ETag cache)
    lib/                 cn, formatters, UTC date helpers, org validation, toast queue
    ui/                  Button, States, Toasts
```

## How it works

1. **Collect** — the scheduler (or a public `POST /refresh`) reads every visible repository across
   every branch, discovers contributors from commits, PRs, reviews and issues, then queries
   `contributionsCollection` in batches for the contribution-graph baseline. A direct repository
   scan adds what GraphQL leaves out: non-default-branch commits, PRs closed/merged after they were
   opened, and issues solved by someone other than the opener. Any repository listed in
   `LEADERBOARD_EXTRA_REPOS` is scanned the same way and merged in, even though it is outside the
   organization. Multi-year windows are split into ≤364-day chunks because GitHub caps a single
   range at one year.
2. **Score** — commits, pull requests, reviews and issues are weighted into one number; ties break
   deterministically. Bots and zero-activity members are dropped.
3. **Cache** — the ranked list is stored per organization, period and range, with `generatedAt`,
   the organization creation date, and any collector warnings.
4. **Serve** — reads come from MongoDB only. `GET /leaderboard/:org` supports `limit`/`offset`
   pagination and sends a weak ETag derived from the snapshot, so repeat views answer
   `304 Not Modified` and reuse the cached body. A missing snapshot is a `202` with a message, not
   an error.

## API overview

All responses are JSON; errors use `{ "error": "..." }`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/leaderboard/:org` | Snapshot from Mongo (never hits GitHub). `?period=month\|all\|custom&limit=1..100&offset=0..`, plus `from`/`to` for `custom`. Supports ETag/304 |
| `GET` | `/leaderboard/:org/meta` | Score weights, GitHub rate-limit budget, organization creation date, snapshot freshness |
| `POST` | `/leaderboard/:org/refresh` | Trigger a refresh (spends GitHub quota). `?period=…`, `from`/`to` for custom, `force=1` to bypass the cache |
| `GET` | `/health` | `{ "status": "ok" }` |

## Scripts

Run from `backend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with watch (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Strict type check |

Run from `frontend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run build` | Type-check and emit static assets to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Strict type check |
| `npm run lint` | ESLint (flat config) |

---

Full backend documentation — environment variables, scoring formula, periods, caching, scheduling,
failure behavior and logging — is in [`backend/README.md`](backend/README.md).
