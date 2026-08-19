# Review gates — TASK-006

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0004_customers.sql` and its `.down.sql`;
`backend/src/database/schema/customers.ts` and `customer-notes.ts`;
`backend/src/customers/` (module, controllers, service, tests);
`backend/src/orgs/workspace.guard.ts` and `current-workspace.decorator.ts`;
`shared/src/customers.ts`. Modified: `permissions.ts` (two new entries),
`orgs.module.ts` (export the new guard), `app.module.ts`, both barrels,
`README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
Two tables. The partial unique index on `(workspace_id, email) where email is
not null` is the subtle one: a plain unique constraint would allow only a
single record without an email per workspace, since Postgres treats nulls as
distinct in a unique index but the composite would still permit duplicates —
the partial form states the intent exactly. `value_cents` is an integer in
minor units; a float would be wrong the first time somebody stores 0.1.

**3. What APIs are affected?**
Seven routes added, all new, all nested under an existing scoped prefix.
Nothing existing changes. `permissions.ts` gains two entries, which widens what
`admin` and `member` may do but changes nothing they could already do.

**4. What existing behavior could regress?**
The permission map is shared, so an error there reaches every route written in
TASK-004 and TASK-005 — mitigated by the exhaustive map test already in place,
which will fail if a role's grants change unexpectedly. `WorkspaceGuard` is
new and composes with `OrgGuard`; if it were to run first or independently it
would grant access on a workspace id alone, so its tests assert it refuses when
the workspace belongs to another organization.

**5. What tests are needed?**
Isolation first, from both directions: another workspace in the same
organization, and a workspace in another organization. Then the things that are
quietly easy to get wrong — `LIKE` escaping, keyset pagination across a full
traversal, the partial unique index with several null emails, and
`converted_at` being stamped once rather than on every transition. Then
permissions and cascades.

**6. Are there simpler alternatives?**
Offset pagination is simpler than keyset and is what most code does; rejected
because UUIDv7 already sorts by time, so keyset costs nothing extra here and
does not degrade. A single `notes` text column on the customer would remove a
table; rejected because it cannot record who wrote what or when, which is most
of the value. Skipping `WorkspaceGuard` and filtering by `workspace_id` in each
handler would work until the first handler forgets.

## After implementation

**1. What changed?**
New `backend/src/customers/`: `customers.service.ts`, `customers.controller.ts`,
`search.ts`, `customers.module.ts`. New `backend/src/orgs/workspace.guard.ts`
and `current-workspace.decorator.ts`, plus `OrgsService.findWorkspace`. New
schema for `customers` and `customer_notes`, migration `0004_customers` with
its down file, and `shared/src/customers.ts`. Modified: `permissions.ts` (two
entries), `orgs.module.ts` (exports the new guard), `app.module.ts`, both
barrels, `README.md`, `docs/BACKLOG.md`.

**2. What tests were added?**
41, taking the suite from 144 to 185. Unit: 5 for `LIKE` escaping, including
that the backslash is escaped before the wildcards. Over HTTP: 36 covering
records and validation, the pipeline (including that `converted_at` is stamped
once and survives churn-and-return), search on each field with `%` and `_`
treated as literals, keyset pagination across a full twelve-record traversal
with limit and cursor validation, the partial unique index from four angles,
isolation from four directions, permissions, and notes including both cascades.

**3. What tests were run?**
`yarn verify` on Node 24 and Node 22 from a clean frozen-install checkout —
185 backend, 7 shared, 9 frontend. Against a running API: a lead was created
with `valueCents` 150000; converting stamped `convertedAt`; churning and
returning left that timestamp unchanged; searching `100%` matched one record
and searching a bare `%` matched **one of three** rather than all three;
a duplicate address in different case was refused with 409; and a note appeared
on the timeline.

The permission map test failed when `customer:read` was added to `member`,
which is what it is for — it was updated deliberately rather than loosened.

**4. Any known limitations?**

- Search is `ILIKE` across three columns, so it scans within a workspace. Right
  at this scale; a trigram index is the answer when it stops being.
- Pagination has one order only, by id, which is creation time ascending. No
  sorting by name, value or stage.
- `stage` is free movement between any two values — there is no workflow, so a
  record can go from `lead` straight to `churned`.
- Notes cannot be edited or deleted, deliberately, which also means a typo is
  permanent and a note added to the wrong customer stays there.
- No import, export, deduplication or merging.
- Still unverified since TASK-001: `docker compose up --build`.

**5. Any technical debt?**

- `WorkspaceGuard` lives in `orgs/` while the things it guards live in
  `customers/`. It is the right place for now; a `tenancy` module would be
  clearer once a third feature uses it.
- The update method spreads six conditional fields to distinguish "absent" from
  "set to null". It works and is explicit, but a helper is due before the next
  table with nullable columns.
- `isUniqueViolation` is now written in three services. It belongs beside the
  database client.
- Listing notes has no pagination, so a customer with thousands returns all of
  them.

**6. Does this follow CLAUDE.md?**

- Rule 1 — the model, the scoping and the feature scope were approved first.
- Rule 2 — no new dependencies.
- Rule 3 — one search-escaping implementation, one permission map, one wire
  contract per shape in `shared`.
- Rule 4 — no UI.
- Rule 5 — cross-workspace and cross-organization access is 404, and a cursor
  from elsewhere selects nothing rather than erroring informatively.
- Rule 6 — bodies and query strings both validate through the pipe, so `limit`
  and `cursor` are checked rather than coerced.
- Rule 9 — the migration drops notes before customers and is tested.
- Rule 10 — every module added ships with tests, isolation included.
  Rules 7 and 8 still wait on TASK-014 and TASK-010. Customer records are exactly
  the data whose changes an audit log should hold.
