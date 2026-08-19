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

## Database

Migrations live in `backend/drizzle/`, one `.sql` forward file and one
`.down.sql` beside it. The pairing is enforced by a test, not a habit: a
migration without a way back fails CI.

```bash
yarn workspace @onestack/backend db:generate   # drizzle-kit writes the up SQL
yarn workspace @onestack/backend db:status     # applied vs pending
yarn workspace @onestack/backend db:migrate    # apply pending
yarn workspace @onestack/backend db:rollback   # revert the last one
```

Migrations never run at boot. A rolling deploy that half-migrates under load
is worse than one that waits for a deliberate command.

Conventions every table inherits from `src/database/schema/columns.ts`:
UUIDv7 primary keys generated in the application, `timestamptz` for
`created_at` and `updated_at`, snake_case throughout.

Integration tests need a throwaway database — they drop the `public` schema:

```bash
createdb onestack_test
TEST_DATABASE_URL=postgres://$USER@localhost:5432/onestack_test yarn test
```

Without `TEST_DATABASE_URL` they skip and say so, rather than passing quietly.

## Authentication

Sessions are rows, not tokens you have to trust. The client holds an opaque
256-bit value in an httpOnly cookie; the database holds only its SHA-256, so
reading the table gives an attacker nothing they can present.

| Endpoint              | Does                                  |
| --------------------- | ------------------------------------- |
| `POST /auth/register` | Creates the account, starts a session |
| `POST /auth/login`    | Starts a session                      |
| `POST /auth/logout`   | Deletes the session row               |
| `GET /auth/me`        | The current user, or 401              |

Passwords are argon2id at OWASP's minimum parameters. Login answers a wrong
password and an unknown email identically, and spends the same time on both,
so neither the body nor the clock reveals which accounts exist.

Guarding a route:

```ts
@UseGuards(SessionGuard)
@Get('customers')
list(@CurrentUser() user: PublicUser) { ... }
```

The guard is opt-in. A global one would silently require a session on routes
that are not ready for it — including the probes, which must answer during an
outage.

## Organizations and workspaces

An organization is the tenant and the billing unit; workspaces subdivide its
data. Membership is at the organization level, with a role of `owner`, `admin`
or `member` — ranked, so a check reads as "admin or above". Registering creates
a personal organization and a `General` workspace, so nobody arrives with
nowhere to put anything.

The organization is named in the path, which keeps two browser tabs on two
organizations from bleeding into each other:

```
GET   /orgs                          organizations you belong to
POST  /orgs
GET   /orgs/{orgId}
PATCH /orgs/{orgId}                  admin or above
GET   /orgs/{orgId}/workspaces
POST  /orgs/{orgId}/workspaces       admin or above
PATCH /orgs/{orgId}/workspaces/{id}  admin or above
DELETE /orgs/{orgId}/workspaces/{id} admin or above
```

Scoping a new route:

```ts
@Controller('orgs/:orgId/customers')
@UseGuards(SessionGuard, OrgGuard)
export class CustomersController {
  @Get()
  list(@CurrentOrg() org: OrgContext) {
    return this.db.select().from(customers).where(eq(customers.organizationId, org.organization.id))
  }
}
```

**A non-member gets 404, never 403.** A 403 would confirm the organization
exists, which is what someone walking through ids is trying to learn. Every
workspace query filters on the organization as well as the id, so an id from
another tenant finds nothing rather than finding a row.

## People

Roles map to named permissions in one place (`src/orgs/permissions.ts`), and
routes ask for the permission rather than for a rank — so adding a role later
is one edit instead of an audit of every controller.

```ts
@RequirePermission('member:remove')
```

Somebody joins by invitation. There is no email provider yet, so creating an
invite returns the token once and you hand it over yourself; when a provider
arrives, the same endpoint sends it.

```
POST   /orgs/{id}/invites          -> { token }  once, never again
GET    /orgs/{id}/invites                        never includes tokens
DELETE /orgs/{id}/invites/{id}
POST   /invites/{token}/accept                   joins the caller
GET    /orgs/{id}/members
PATCH  /orgs/{id}/members/{userId}               change role
DELETE /orgs/{id}/members/{userId}               remove, or leave
```

Invite tokens are 256-bit values stored as SHA-256, exactly like sessions, and
are single-use with a seven-day life. Accepting binds to the caller's session,
not to the address on the invitation.

**The last owner is protected.** They cannot be demoted, removed, or leave —
by anyone, including themselves. An organization with no owner has nobody who
can appoint one.

An admin holds the same permissions as an owner. What separates them is who
they may act on: an admin cannot change an owner's role, grant the owner role,
or invite an owner.

## Your account

```
GET   /users/me
PATCH /users/me            name only
POST  /users/me/password   current password required
```

Changing a password revokes every other session and keeps the current one —
which is the actual remedy once a session has been stolen.

## Health

| Endpoint      | Answers                  | Fails when                  |
| ------------- | ------------------------ | --------------------------- |
| `GET /health` | Is the process alive     | The process is broken       |
| `GET /ready`  | Should traffic come here | The database is unreachable |

They are separate on purpose: a database blip must not make the orchestrator
restart a perfectly healthy container.

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
