# OneStack

An operating system for a one-person company.

## Layout

```
shared/     types and zod schemas both sides import
backend/    NestJS API
frontend/   Next.js site
docs/       roadmap, backlog, specs, review gates
```

## Getting started

Requires Node 22 (`.nvmrc`) and yarn 1.

```bash
yarn install
cp .env.example .env      # set POSTGRES_PASSWORD, check DATABASE_URL
yarn api:dev              # API on :4000
yarn dev                  # site on :3000
```

The API validates its environment at boot and refuses to start with a message
naming any variable that is missing or malformed.

## Commands

| Command                         | Does                                 |
| ------------------------------- | ------------------------------------ |
| `yarn dev` / `yarn api:dev`     | Run the site / the API in watch mode |
| `yarn build` / `yarn api:build` | Production builds                    |
| `yarn typecheck`                | TypeScript across every workspace    |
| `yarn lint`                     | ESLint                               |
| `yarn test`                     | Vitest across every workspace        |
| `yarn format`                   | Prettier write                       |

## Containers

```bash
docker compose up --build
```

Postgres starts first, the API waits for it, the site waits for the API's
`/health`. Postgres is not published to the host.

## Working agreement

Read [CLAUDE.md](CLAUDE.md) first. Every task gets a spec from
[docs/templates/SPEC.md](docs/templates/SPEC.md) and passes both gates in
[docs/templates/REVIEW.md](docs/templates/REVIEW.md) before it is done. The
task list is [docs/BACKLOG.md](docs/BACKLOG.md).
