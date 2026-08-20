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

## Customers

A lead and a customer are the same person at different moments, so there is one
table with a stage: `lead`, `qualified`, `active`, `churned`. Converting is a
stage change — no data is copied, and `converted_at` is stamped the first time
somebody reaches `active` and never restamped, so a customer who churns and
returns keeps the date they first joined.

Records live in a workspace, which is a real boundary rather than a label:

```
POST   /orgs/{orgId}/workspaces/{workspaceId}/customers
GET    .../customers?q=&stage=&cursor=&limit=
GET    .../customers/{id}
PATCH  .../customers/{id}
DELETE .../customers/{id}
POST   .../customers/{id}/notes
GET    .../customers/{id}/notes
```

`WorkspaceGuard` runs after `OrgGuard` and proves the workspace belongs to the
organization the caller was already admitted to — a workspace id on its own
grants nothing.

Pagination is keyset, not offset: UUIDv7 ids already sort by creation time, so
`where id > cursor order by id` needs no extra column and page one thousand
costs what page one costs. Search is escaped before it reaches `LIKE`, so
searching for `%` finds a percent sign rather than every record.

Money is `value_cents`, an integer of minor units. Never a float.

Notes are append-only and cannot be edited or deleted — a timeline that can be
rewritten is not a timeline. A note survives its author leaving, with a null
author.

## Products

A catalogue lives in a workspace, beside the customers who buy from it.

```
POST   /orgs/{orgId}/workspaces/{workspaceId}/products
GET    .../products?q=&status=&cursor=&limit=
GET    .../products/{id}                      includes its prices
PATCH  .../products/{id}                      name, sku, description
DELETE .../products/{id}                      only while it has no prices
POST   .../products/{id}/archive
POST   .../products/{id}/unarchive
POST   .../products/{id}/prices
GET    .../products/{id}/prices?active=true
POST   .../products/{id}/prices/{priceId}/archive
```

**Prices are immutable.** Nothing changes an amount, a currency or an interval
once a price exists — there is no route that can. Raising a price means adding
a new one and archiving the old, so a subscription created against a price
still describes what was agreed. That is also an integrity control: a
compromised session can add a price or archive one, both of which leave a
record, but cannot quietly rewrite what customers are charged.

A product with prices cannot be deleted, only archived, so TASK-008's
subscriptions can never point at a row that vanished. Archiving a product
leaves its prices readable for exactly that reason.

Amounts are integer minor units. Currency is a three-letter ISO 4217 code,
uppercased on the way in so `usd` and `USD` cannot become two currencies.

## Subscriptions

A subscription joins a customer to a price. This is where the MRR figure comes
from.

```
POST  .../subscriptions                 customerId, priceId, trialDays?
GET   .../subscriptions?status=&customerId=&cursor=
GET   .../subscriptions/summary         MRR and counts
GET   .../subscriptions/{id}
PATCH .../subscriptions/{id}            change price
POST  .../subscriptions/{id}/cancel     { immediately?: false }
POST  .../subscriptions/{id}/resume
POST  .../subscriptions/{id}/renew
```

Statuses are `trialing`, `active`, `past_due` and `canceled`. Cancelling
defaults to the end of the period — somebody who cancels keeps what they paid
for, and can resume until it lapses. Renewal is where a scheduled cancellation
actually takes effect.

Renewing advances the period from **where the last one ended**, not from now,
so a renewal that runs late does not quietly shorten the month.

`price_id` is `restrict` rather than `cascade`: a price somebody is subscribed
to cannot be deleted. TASK-007 already refuses to delete a priced product, so
the guarantee holds from both sides.

MRR normalises a yearly price to a twelfth of itself, ignores one-off prices,
counts `active` and `trialing`, and is reported **per currency** rather than
summed — adding USD to EUR gives a number that looks authoritative and means
nothing.

Money movement — invoices, proration, dunning — is TASK-013. Nothing here
charges anybody.

## AI

One interface over Anthropic, OpenAI and Google. A caller changes `model` and
nothing else — the adapter translates roles, system prompts and usage fields
into the same shape whichever vendor answers.

```
GET  /orgs/{orgId}/workspaces/{workspaceId}/ai/models
POST /orgs/{orgId}/workspaces/{workspaceId}/ai/complete
```

Every response carries what it cost, which is what CLAUDE.md rule 8 needs:

```json
{
  "model": "claude-opus-5",
  "provider": "anthropic",
  "text": "...",
  "usage": { "inputTokens": 1000, "outputTokens": 500 },
  "costMicroUsd": 17500,
  "costCents": 2
}
```

Prices live in `src/ai/registry.ts` as **integer micro-dollars per million
tokens** — a millionth of a dollar, so no float ever touches money. Each entry
records the source it came from and the date it was checked, because a price
nobody verified is worse than no price. `costMicroUsd` is exact; `costCents` is
for display, and a small request rounding to zero cents still carries its exact
micro-dollar amount so a month of them adds up correctly.

Keys are optional and server-side only:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
```

A provider without a key is simply unavailable — its models are absent from
`/ai/models` and asking for one returns 422 naming the provider. The API boots
either way, so an unused vendor is nobody's problem. Keys never appear in a
response, a log line, or an error: the adapters map vendor errors onto domain
errors rather than passing the vendor's message through.

Prompts and answers are never logged or stored. They are customer data, and an
AI request log is the easiest place to leak them by accident.

### What every call leaves behind

Recording happens inside `AiService`, around the provider call — not in an
interceptor on the controller. Rule 8 says _every_ AI request, and TASK-011's
automation engine will call the service directly, where an interceptor would
never see it.

```
GET /orgs/{orgId}/workspaces/{workspaceId}/ai/usage?from=&to=
GET /orgs/{orgId}/workspaces/{workspaceId}/ai/requests?status=&model=&cursor=
```

One row per call: provider, model, tokens, cost, duration, status, who and
where. **No prompt, no answer** — a leak of this table exposes what was spent,
not what anybody asked.

Failed calls are recorded too, with the domain error code and never a vendor
message. A failure nobody recorded is a bill nobody can explain.

Writing the record can never fail the request. By the time it runs the answer
has been generated and paid for; losing it because bookkeeping failed would be
the worse outcome, so `record` logs its own failure and returns.

`cost_micro_usd` is a **bigint** — micro-dollars are millionths, so `integer`
would top out near $2,147 and wrap silently. Totals are summed from the rows on
read, so they cannot drift from them.

## Automation

Workflows are a list of steps with a trigger. They run manually or on a cron
schedule, and every run is recorded step by step.

```
POST   /orgs/{orgId}/workspaces/{workspaceId}/workflows
GET    .../workflows
GET    .../workflows/{id}
PATCH  .../workflows/{id}              including enable and disable
DELETE .../workflows/{id}
POST   .../workflows/{id}/run
GET    .../workflows/{id}/runs
GET    .../workflows/runs/{runId}      with its steps
```

Two actions: `ai.complete` and `http.request`. A step can use an earlier step's
output as `{{steps.0.text}}`, and a reference to a step that has not run is
refused **when the workflow is written** — finding that out at three in the
morning is not the moment for it.

### The queue

Jobs live in Postgres and are claimed with `FOR UPDATE SKIP LOCKED`, so a
second worker steps over a locked row rather than waiting for it. Without that
the choice is serialising every worker behind one lock, or double-processing —
and double-processing a paid AI call means paying twice. This is tested with
two real connections, not by reasoning about the SQL.

Failures retry with growing backoff — 30s, 2m, 8m — and go `dead` after the
last attempt, a terminal state the claim query does not look at. A worker that
dies holding a job leaves a lock that ages out after five minutes, and the job
is reclaimed rather than stuck forever.

The worker starts from `main.ts`, not on module init: every end-to-end test
boots the application, and a worker that started itself would have every suite
quietly running background work.

### HTTP steps are the dangerous part

A workflow is user input containing a URL, executed by the server — that is
server-side request forgery unless the destination is checked. It is:

- the **resolved address** is checked, not the hostname, because a hostname an
  attacker controls can resolve wherever they like
- loopback, RFC 1918, link-local (including `169.254.169.254`), carrier-grade
  NAT, multicast and their IPv6 equivalents are all refused
- redirects are not followed, because a redirect is a second destination that
  has not been checked
- response bodies are truncated before storage
- the refusal says nothing about the topology it is protecting

AI steps go through `AiService`, so they are recorded in `ai_requests` like
every other call. Rule 8 has no exception for automation.

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
