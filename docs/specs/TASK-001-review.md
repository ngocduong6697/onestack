# Review gates — TASK-001

## Before implementation

**1. What files will change?**
All new; nothing existing is touched except that `CLAUDE.md` and `docs/` become
tracked. Root: `package.json`, `.prettierrc.json`, `.gitignore`, `.nvmrc`,
`docker-compose.yml`, `.env.example`, `README.md`, `.github/workflows/ci.yml`.
Three workspaces: `shared/`, `backend/`, `frontend/`, each with its own
`package.json`, `tsconfig.json`, sources, tests and Dockerfile.

**2. What database changes are required?**
None. Compose runs Postgres 16 so the container topology is real from day one,
but no client, schema or migration exists until TASK-002.

**3. What APIs are affected?**
None exist yet. One is added: `GET /health`.

**4. What existing behavior could regress?**
Nothing — the repository has no commits. The risk is forward-looking: choosing
a monorepo shape that later fights Phase 4 (jobs, webhooks) or Phase 6
(rate limiting). Mitigated by matching a structure already carrying those
concerns in the sibling project.

**5. What tests are needed?**
Env schema accepts valid input and rejects a bad port; health controller shape;
exception filter maps a domain error to its status; home route renders. Four
tests across three workspaces — enough to prove each toolchain executes.

**6. Are there simpler alternatives?**
Yes: a single Next.js app with route handlers, which is closer to KISS and
YAGNI. Rejected at your direction in favour of the house monorepo, because
Phase 4 needs a process that is not a request handler and retrofitting one is
more expensive than starting with it.

## After implementation

**1. What changed?**
New repository skeleton, 34 files. Root: yarn workspace manifest, prettier,
eslint-free (lint lives in the frontend workspace), gitignore, `.nvmrc`,
`.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`.
`shared/`: env helpers (`portSchema`, `csvSchema`, `parseEnv`) and the
`/health` contract. `backend/`: NestJS app with zod-validated environment,
domain error hierarchy, a single exception filter, log-level translation, and
the health controller. `frontend/`: Next 15 App Router shell, Tailwind 4,
security headers, `cn` helper. Dockerfiles for both runnable workspaces.

**2. What tests were added?**
12 across three workspaces — 7 in `shared` (port coercion and rejection, CSV
splitting, valid parse, multi-variable failure message), 4 in `backend`
(health contract, domain error mapping, HttpException passthrough, unknown
error redaction + logging), 1 in `frontend` (home heading renders).

**3. What tests were run?**
`yarn format:check`, `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`,
`yarn api:build` — all pass. Beyond the suite: the API was booted and
`GET /health` returned `{"status":"ok","uptime":0,"version":"0.1.0"}` with
helmet headers present; boot was confirmed to fail and name the variable for
both a missing `DATABASE_URL` and an out-of-range `API_PORT`;
`docker compose config` validates and refuses to interpolate without
`POSTGRES_PASSWORD`.

**4. Any known limitations?**

- `docker compose up --build` was **not** run: no Docker daemon on this
  machine. Compose config is valid and the Dockerfile COPY paths were checked
  against the real `.next/standalone` layout, but the images are unbuilt and
  therefore unproven.
- `DATABASE_URL` is required at boot while nothing connects yet, so the API
  will not start without it even though TASK-001 never queries.
- `/health` is liveness only. Readiness, which should test Postgres, waits for
  TASK-002 and TASK-018.
- CSP still carries `'unsafe-inline'` for scripts; removing it needs a nonce
  threaded through the Next bootstrap.

**5. Any technical debt?**

- No `/ready`, no request-id correlation, no structured JSON log transport —
  Nest's default console logger is human-formatted. Phase 6 (observability)
  should replace it.
- The frontend has no API client yet; `NEXT_PUBLIC_API_URL` is declared and
  unused until Phase 1.
- `@testing-library/jest-dom` resolves to 6.10.0, which warns about a breaking
  minor. Its stated requirements (Node >= 22, `@testing-library/dom` peer) are
  now satisfied and tests pass, but the version is worth watching.

**6. Does this follow CLAUDE.md?**
Yes, with the rules that apply at this stage:

- Rule 1 — architecture approved before any code was written.
- Rule 2 — every dependency mirrors the sibling project's proven set; the only
  judgement calls are `helmet` (rule 5) and `zod` (rule 6), both mandated.
  Nest's built-in logger was used instead of adding pino.
- Rule 3 — the `/health` contract lives once, in `shared`.
- Rule 4 — no business logic exists yet; the boundary is established.
- Rule 5 — `.env` gitignored, `.env.example` carries names only, unknown
  errors return an opaque 500 rather than leaking internals.
- Rule 6 — validation infrastructure (zod + `parseEnv`) is in place; `/health`
  takes no input.
- Rule 10 — every module added ships with a test.
  Rules 7, 8 and 9 (audit, AI cost, migrations) have nothing to bind to yet and
  land in TASK-014, TASK-010 and TASK-002.
