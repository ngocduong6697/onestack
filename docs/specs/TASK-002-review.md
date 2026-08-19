# Review gates — TASK-002

## Before implementation

**1. What files will change?**
New: `backend/src/database/` (client, module, schema conventions, migrate
runner, uuid helper), `backend/src/health/ready.controller.ts` and its test,
`backend/drizzle.config.ts`, `drizzle/0000_extensions.sql` and its `.down.sql`.
Modified: `backend/package.json` (drizzle-orm, drizzle-kit, postgres, uuid and
the `db:*` scripts), `backend/src/app.module.ts` (register DatabaseModule),
`backend/src/config/env.ts` (pool settings), `.env.example` and
`docs/BACKLOG.md` (status). `README.md` gains a database section.

**2. What database changes are required?**
One migration installing `pgcrypto` and `citext`, with a down migration that
drops them. No tables — that is the point of the approved scope.

**3. What APIs are affected?**
None existing. One added: `GET /ready`. `/health` is untouched, and keeping
them separate is deliberate: liveness must not fail when the database does.

**4. What existing behavior could regress?**
The API currently boots with no database reachable. Registering a pool at
module scope risks turning a missing database into a boot failure, which
would break local frontend work. Mitigation: the pool connects lazily and
`/health` never touches it, so the API still starts when Postgres is down —
`/ready` is what reports the problem.

**5. What tests are needed?**
UUIDv7 sortability and version bits; a guard test asserting every migration
has a down sibling; readiness controller on both branches with a mocked probe;
and an integration test that migrates, asserts the extensions exist, rolls
back and asserts they are gone — skipped with a message when
`TEST_DATABASE_URL` is unset, so CI without a database stays honest rather
than silently green.

**6. Are there simpler alternatives?**
Yes, two, both rejected. `drizzle-kit push` needs no migration files at all,
but it diffs against the live database and cannot be reviewed in a pull
request or reverted — it fails rule 9 outright. Forward-only migrations were
offered and declined. Skipping `/ready` and reusing `/health` is simpler still,
but conflates liveness with readiness, which is how a database hiccup turns
into a restart loop.

## After implementation

**1. What changed?**
New in `backend/src/database/`: `ids.ts` (UUIDv7), `schema/columns.ts` and
`schema/index.ts` (conventions), `client.ts` (pool + close), `database.module.ts`
(global provider, shutdown hook), `database.health.ts` (probe), `migrate.ts`
(runner + CLI). New `backend/drizzle.config.ts`, `backend/drizzle/0000_extensions.sql`
and its `.down.sql`, and `backend/src/health/ready.controller.ts`. Modified:
`backend/src/config/env.ts` (three pool settings), `common/errors.ts`
(`ServiceUnavailableError`), `app.module.ts`, `shared/src/health.ts`
(readiness contract), `.env.example`, `README.md`, `.github/workflows/ci.yml`
(a Postgres service), `docs/BACKLOG.md`.

Migrations live in `backend/drizzle/`, not the repository root as the approved
sketch showed. They belong to the workspace that runs them, and the root
location would not be copied into the API image, leaving TASK-018 unable to
migrate on deploy.

**2. What tests were added?**
15, taking the suite from 12 to 27. UUIDv7 (version bits, uniqueness across
1000, time-ordering); migration files (directory resolves, every migration has
a down sibling, ids sort); readiness (ready, 503, no leak); and six
integration tests that apply, prove both extensions exist, prove idempotency,
report status, roll back, prove the extensions are gone, and re-apply.

**3. What tests were run?**
`yarn format:check`, `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`,
`yarn api:build` — all pass, 27 tests, with the integration suite live against
local Postgres 16.14. Also verified by hand:

- `db:status` -> pending, `db:migrate` -> applied, second run -> "Nothing to
  apply", `db:rollback` -> reverted with both extensions gone from
  `pg_extension`, second rollback -> "Nothing to revert", re-apply -> works
- Guard 1: a migration without a `.down.sql` is refused, naming rule 9
- Guard 2: editing an already-applied migration is refused
- `/health` stays 200 with the database unreachable; `/ready` returns 503
  `{"error":{"code":"service_unavailable"}}` and the body contains neither the
  port nor the connection string
- SIGTERM takes `pg_stat_activity` from 1 connection to 0
- Without `TEST_DATABASE_URL` the integration file reports 6 skipped, not green

**4. Any known limitations?**

- Rollback is one migration per invocation, with no `--to <id>`. Deliberate:
  bulk reversal is where data gets lost by accident.
- The down migration for `0000_extensions` will start failing once a `citext`
  column exists, which is correct — it refuses rather than dropping columns
  with CASCADE — but it means this particular migration stops being reversible
  after TASK-003. That is the "when possible" in rule 9, and the file says so.
- No advisory lock around the migration run, so two deploys migrating at once
  could race. Single-host today; TASK-018 should add `pg_advisory_lock`.
- Still unverified from TASK-001: `docker compose up --build` — no Docker
  daemon on this machine.

**5. Any technical debt?**

- `schema/index.ts` exports only conventions; the first real table will need a
  drizzle-kit generate run to confirm the config path is right end to end.
- The runner reads the whole migration into memory and splits on drizzle's
  breakpoint comment. Fine for DDL, wrong for a large data backfill — those
  should be scripts, not migrations, and nothing enforces that yet.
- `DatabaseHealth` runs `select 1` with no timeout of its own, relying on
  `connect_timeout`. A hung-but-connected database would hang the probe.

**6. Does this follow CLAUDE.md?**

- Rule 1 — primary keys, reversibility and scope were all approved first.
- Rule 2 — four dependencies, each load-bearing: `drizzle-orm` and `postgres`
  are the approved stack, `drizzle-kit` generates the SQL, `uuid` supplies the
  v7 bit layout that the approved key strategy requires.
- Rule 3 — the readiness contract lives once in `shared`; column conventions
  live once in `schema/columns.ts`.
- Rule 4 — no UI touched.
- Rule 5 — `DATABASE_URL` is server-side only and never `NEXT_PUBLIC_`; the
  probe logs driver errors and returns none of them.
- Rule 6 — no user input reaches this task; raw SQL is confined to migration
  files, and everything else goes through Drizzle's binding.
- Rule 9 — satisfied and enforced by a test rather than trusted to memory.
- Rule 10 — every module added ships with a test.
  Rules 7 and 8 (audit, AI cost) still have nothing to bind to; they land in
  TASK-014 and TASK-010 on top of these conventions.
