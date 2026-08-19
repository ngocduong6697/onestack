# Review gates — TASK-004

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0002_organizations_workspaces.sql` and its `.down.sql`;
`backend/src/database/schema/organizations.ts`, `workspaces.ts`,
`memberships.ts`; `backend/src/orgs/` (module, controllers, services, guard,
`@CurrentOrg`, `@RequireRole`, roles, slug, tests);
`shared/src/orgs.ts`. Modified: `backend/src/auth/auth.service.ts` (create an
organization and workspace on register), `app.module.ts`, both schema and
shared barrels, `README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
Three tables. `memberships` is the join that makes tenancy real, with a unique
`(organization_id, user_id)` so nobody holds two roles at once, and an index on
`user_id` because "which organizations am I in" runs on every navigation.
Workspace slugs are unique per organization rather than globally.

**3. What APIs are affected?**
`POST /auth/register` gains a side effect: it now creates an organization and a
workspace inside the same transaction as the user. Eight routes are added under
`/orgs`. Nothing existing changes shape.

**4. What existing behavior could regress?**
Registration is the risk. It becomes a multi-table write, so a failure halfway
through would leave a user with no organization — mitigated by doing all of it
in one transaction, and by a test that asserts a failed org insert rolls the
user back too. The auth tests also assert the response shape is unchanged,
since register now does more but must return the same body.

**5. What tests are needed?**
Unit for slug generation and role ranking, because both are pure and both are
easy to get subtly wrong. Integration for the cascades and for registration's
transaction. HTTP for the whole route table from four vantage points — owner,
admin, member, outsider — with the outsider path asserted to be 404 rather
than 403 on every route, including ones where the target id genuinely exists.

**6. Are there simpler alternatives?**
Yes. Dropping `memberships` and putting `organization_id` on `users` would
remove a table and a join, and is what a single-tenant-per-user product would
do — rejected because it cannot express a second person joining, which Phase 2
onward assumes. Checking membership inside each handler instead of a guard
would avoid the decorator machinery, and is exactly how a route eventually
ships without the check. Returning 403 for non-members would be more honest
and would leak which organization ids exist.

## After implementation

**1. What changed?**
New `backend/src/orgs/`: `roles.ts` (ranked roles), `slug.ts`, `orgs.service.ts`,
`orgs.controller.ts`, `workspaces.controller.ts`, `org.guard.ts`,
`current-org.decorator.ts` (`@CurrentOrg`, `@RequireRole`), `orgs.module.ts`.
New schema files for all three tables, migration `0002_organizations_workspaces`
with its down file, and `shared/src/orgs.ts`. Modified: `auth.service.ts`
(register is now a transaction spanning user, organization, workspace and
session), `auth.module.ts`, `app.module.ts`, both barrels, `README.md`,
`docs/BACKLOG.md`.

`AuthModule` became `@Global`, like `DatabaseModule`. Registration needs
`OrgsService` while every scoped controller needs `SessionGuard`, which is a
cycle if both modules import each other. Making identity globally available —
which it is — breaks it without `forwardRef`.

**2. What tests were added?**
36, taking the suite from 71 to 107. Unit: 14 for slug generation (accents,
punctuation, truncation without a trailing separator, the empty-slug floor,
collision suffixes staying within the length limit) and 3 for role ranking.
19 over HTTP: the registration bootstrap, organization creation and slug
suffixing, the full workspace lifecycle, per-organization slug scoping, role
enforcement from member, admin and owner, both cascades, and five isolation
tests.

**3. What tests were run?**
`yarn verify` on Node 24 locally and Node 22 from a clean frozen-install
checkout — 107 backend, 7 shared, 9 frontend. Against a running API: a new
account arrived owning `Alice's Organization` with a `General` workspace;
reading and writing another tenant's organization both returned 404 with the
same body as a missing one; a workspace id belonging to Bob, submitted through
Alice's own organization by an owner of that organization, returned 404 and the
row was verified unchanged in the database afterwards; and a demoted member got
403 on an admin route.

**4. Any known limitations?**

- No invitations and no member management, so a second person cannot join an
  organization through the API — only by inserting a membership row. Invitations
  need email; the rest is TASK-005.
- No way to delete an organization. It cascades to everything the company owns,
  so it needs a confirmation flow and a retention policy rather than a route.
- Membership grants every workspace in the organization. The table is shaped so
  per-workspace grants can be added without moving data, but they do not exist.
- Slug uniqueness reads the existing slugs and then inserts, so two
  simultaneous creates with the same name can race. The unique index catches it
  as a 500 rather than a suffix; the window is small and single-user, but it is
  real.
- Isolation rests on the guard and on every query filtering by organization.
  There is no database-level backstop — RLS was offered and declined, and
  remains the Phase 6 answer.
- Still unverified since TASK-001: `docker compose up --build`.

**5. Any technical debt?**

- `OrgsService` carries both organization and workspace concerns. It is small
  now; workspaces should split off before they grow.
- The `Executor` type for "a transaction or the pool" is declared in two files.
  It belongs in the database module.
- `GET /orgs` returns every organization with no pagination. Fine at the scale
  one person operates at, wrong at a thousand.

**6. Does this follow CLAUDE.md?**

- Rule 1 — tenancy shape, isolation strategy, selection mechanism and scope
  were all approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — roles are ranked in one place, slugs generated in one place, and the
  wire shapes live once in `shared`.
- Rule 4 — no UI.
- Rule 5 — cross-tenant responses reveal nothing, not even existence.
- Rule 6 — every route with a body validates through the pipe, and the update
  schemas reject an empty patch rather than silently doing nothing.
- Rule 9 — the migration drops children before parents and is tested.
- Rule 10 — every module added ships with tests, and isolation is tested from
  an attacker's position rather than only from a member's.
  Rules 7 and 8 still wait on TASK-014 and TASK-010.
