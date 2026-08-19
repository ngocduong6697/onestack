# TASK-001 — Project foundation

Phase 0. Approved architecture: yarn workspaces monorepo mirroring the
house style already proven in `~/Projects/Personal/tools`.

## Goal

A repository a single person can clone, run, test and deploy on day one:
one command for the app, one for the API, one for the test suite, and a
container stack that starts Postgres behind a healthy API.

## Scope

- yarn 1 workspaces: `frontend`, `backend`, `shared`
- `frontend`: Next 15 (App Router), React 19, Tailwind 4, TS strict
- `backend`: NestJS 11, helmet, zod-validated environment, TS strict
- `shared`: types and zod schemas consumed by both sides
- Tooling: ESLint 9, Prettier (+ tailwind plugin), Vitest
- Structured logging and a single error-to-HTTP translation point
- Docker: per-workspace Dockerfiles, compose with Postgres + healthchecks
- CI: install, typecheck, lint, test, build on push and PR

## Non-goals

- Database schema, migrations, Drizzle wiring — that is TASK-002
- Auth, users, organizations — Phase 1
- Any business logic. This task ships a skeleton, not a feature.

## Database changes

None. Compose provisions a Postgres 16 container and the API reads
`DATABASE_URL`, but no client connects and no schema exists until TASK-002.

## API changes

New: `GET /health` — liveness probe returning status and uptime. Used by the
compose healthcheck and by TASK-018 deployment.

## UI changes

A single placeholder route rendering the app shell, proving Tailwind and the
font pipeline work end to end. No dashboard until TASK-015.

## Acceptance criteria

- `yarn install` succeeds from a clean checkout
- `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build` all pass
- `yarn dev` serves the site; `yarn api:dev` serves the API
- `GET /health` returns 200 with a JSON body
- `docker compose up --build` brings up Postgres, then API, then site
- Missing or malformed environment variables fail at boot with a message
  naming the offending variable, not a stack trace at first use

## Tests

- `shared`: env schema accepts a valid environment, rejects a bad port
- `backend`: health controller returns the expected shape
- `backend`: exception filter maps a domain error to its HTTP status
- `frontend`: home route renders its heading

## Security considerations

- helmet on the API; explicit security headers on the site (CSP, frame-deny,
  nosniff, referrer policy, permissions policy)
- Secrets live only in `.env`, which is gitignored. `.env.example` carries
  names and shapes, never values (CLAUDE.md rule 5)
- Postgres is not published to the host in compose; only the API reaches it
- `POSTGRES_PASSWORD` has no default — compose refuses to start without it

## Performance considerations

- Multi-stage Docker builds so runtime images carry no toolchain
- `output: 'standalone'` for the Next build to keep the runtime image small
- Vitest over Jest for startup time, matching the sibling project
