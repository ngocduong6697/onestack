# TASK-002 — Database architecture

Phase 0. Depends on TASK-001. Approved decisions: UUIDv7 primary keys
generated in the application, paired up/down SQL migrations, plumbing and
extensions only — feature tables belong to the tasks that own them.

## Goal

Everything a table needs to exist except the tables: a pooled connection with
a clean shutdown, a migration pipeline that can go backwards, column
conventions no future task has to reinvent, and a readiness probe that tells
the truth about whether the database is reachable.

## Scope

- Drizzle ORM over `postgres` (postgres.js), wired as a Nest module
- Pool sized from the environment, closed on shutdown hooks
- `drizzle-kit` config generating SQL into `drizzle/`
- Migration runner: `db:generate`, `db:migrate`, `db:rollback`, `db:status`
- Every generated migration gets a hand-written `.down.sql` sibling
- Column conventions in one place: UUIDv7 primary key, `created_at`,
  `updated_at`, snake_case naming
- First migration: `pgcrypto` and `citext` extensions
- `GET /ready` — readiness, distinct from TASK-001's liveness `/health`

## Non-goals

- Any feature table. Users are TASK-003, organizations TASK-004.
- Audit log tables (TASK-014) and AI usage tables (TASK-010), even though both
  will use these conventions.
- Read replicas, sharding, connection proxies. YAGNI at one person.
- Seed data. Nothing to seed until there are tables.

## Database changes

Migration `0000_extensions`:

- `CREATE EXTENSION IF NOT EXISTS pgcrypto` — `gen_random_uuid()` as a
  server-side fallback and, later, password hashing support for TASK-003
- `CREATE EXTENSION IF NOT EXISTS citext` — case-insensitive email columns
  without a functional index on every lookup

Down migration drops both. Dropping an extension is safe only while nothing
depends on it, which is true exactly now — recorded in the file as a comment.

## API changes

New: `GET /ready` — runs `SELECT 1` against the pool. Returns 200 when the
database answers, 503 when it does not. Deliberately separate from `/health`:
a database blip must not make the orchestrator kill a healthy process.

## UI changes

None.

## Acceptance criteria

- `yarn db:migrate` applies cleanly to an empty database and is idempotent on
  a second run
- `yarn db:rollback` reverts the last migration and leaves the database in its
  prior state
- `yarn db:status` lists applied and pending migrations
- A migration generated without a matching `.down.sql` fails the check, so
  rule 9 cannot be forgotten silently
- `GET /ready` returns 200 with the database up, 503 with it down
- The pool closes on SIGTERM without leaving connections behind
- `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` still pass

## Tests

- `uuidv7()` produces sortable, unique, correctly-versioned identifiers
- Column conventions produce the expected DDL types
- Every migration in `drizzle/` has a `.down.sql` sibling — a test, not a
  convention, so it fails CI
- Readiness controller returns 200 on a healthy probe, 503 on a failing one
- Integration: migrate, assert both extensions exist, rollback, assert they do
  not — skipped with a clear message when `TEST_DATABASE_URL` is unset

## Security considerations

- Queries go through Drizzle's parameter binding; raw SQL is confined to
  migration files (CLAUDE.md rule 6 in spirit — no string-built SQL)
- `DATABASE_URL` stays server-side only. It is never referenced under a
  `NEXT_PUBLIC_` name (rule 5)
- `/ready` reports reachable or not, never the connection string, the driver
  error, or the schema
- Migrations run as a deliberate command, never automatically at boot, so a
  rolling deploy cannot half-migrate under load

## Performance considerations

- Pool max defaults to 10 and is environment-tunable; postgres.js keeps
  prepared statements per connection
- UUIDv7 is time-ordered, so primary key inserts stay at the right edge of the
  B-tree instead of scattering like UUIDv4
- `idle_timeout` and `connect_timeout` set so a dead database fails fast
  rather than hanging a request
