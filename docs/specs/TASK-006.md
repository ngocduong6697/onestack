# TASK-006 — Customer CRM

Phase 2. Depends on TASK-005. Approved decisions: one `customers` table with a
lifecycle stage, workspace-scoped behind nested routes, covering records,
pipeline, search and notes.

## Goal

Somewhere to keep the people who pay you, and the people who might — one
record per person that survives becoming a customer, with enough history
attached to remember what was said.

## Scope

- `customers` and `customer_notes`, workspace-scoped
- Stages `lead`, `qualified`, `active`, `churned`, with `converted_at` stamped
  on first reaching `active`
- CRUD, search by name, email or company, filter by stage
- Keyset pagination, ordered by id — UUIDv7 already sorts by creation time, so
  no extra column and no offset scan
- `WorkspaceGuard`, which resolves the workspace and proves it belongs to the
  organization the caller was already admitted to
- Notes as an append-only timeline

## Non-goals

- Tags and custom fields. Both were offered and declined; neither should be
  built before real records exist to shape them.
- Import and export, deduplication, merging.
- Email or any outbound contact. There is still no provider.
- Deals or opportunities separate from the customer. The stage is the pipeline.
- Editing or deleting notes. A timeline that can be rewritten is not one.

## Database changes

Migration `0004_customers`, reversible.

`customers` — `id`, `workspace_id` FK cascade, `name`, `email` (citext,
nullable), `company`, `phone`, `stage`, `value_cents` (integer, default 0),
`converted_at`, `notes` as a free-text field is **not** included — notes are
rows, timestamps.

Unique on `(workspace_id, email) where email is not null` — a partial index,
because most workspaces should not hold the same address twice, but a record
without an address is perfectly normal and several of them must coexist.

Indexed on `(workspace_id, stage)` for the pipeline view and `(workspace_id,
id)` for pagination.

`customer_notes` — `id`, `customer_id` FK cascade, `author_id` FK to users
`on delete set null`, `body`, timestamps. Indexed on `(customer_id, id)`.

`author_id` is `set null` so a note outlives the person who wrote it; the note
is a record of what was said, not a possession of the author.

## API changes

All under `/orgs/:orgId/workspaces/:workspaceId/customers`.

| Endpoint                  | Permission       | Notes                           |
| ------------------------- | ---------------- | ------------------------------- |
| `POST /`                  | `customer:write` | 201                             |
| `GET /`                   | `customer:read`  | `q`, `stage`, `cursor`, `limit` |
| `GET /:customerId`        | `customer:read`  |                                 |
| `PATCH /:customerId`      | `customer:write` | Including stage                 |
| `DELETE /:customerId`     | `customer:write` | 204, cascades notes             |
| `POST /:customerId/notes` | `customer:write` | 201                             |
| `GET /:customerId/notes`  | `customer:read`  | Newest first                    |

New permissions `customer:read` and `customer:write`: members read, admins and
owners write.

## UI changes

None.

## Acceptance criteria

- A customer created in workspace A is invisible from workspace B, including to
  someone who is an owner of both, and the response is 404 rather than 403
- A workspace id belonging to another organization is 404, even for an owner
- Moving a customer to `active` stamps `converted_at` once and never restamps
  it on a later transition back and forth
- The same email cannot appear twice in one workspace, but any number of
  records without an email can
- Search matches on name, email and company, is case-insensitive, and does not
  treat `%` or `_` in the query as wildcards
- Pagination returns every record exactly once across pages, with no gaps and
  no repeats, and a cursor from another workspace yields nothing
- Deleting a customer deletes its notes; deleting the note's author leaves the
  note with a null author rather than removing it
- `yarn verify` passes

## Tests

- Stage transitions, including that `converted_at` is stamped once
- Search: case-insensitivity, matching each field, and that `%` and `_` are
  escaped rather than acting as wildcards
- Pagination: full traversal with no duplicates or gaps, a limit cap, and a
  cursor that belongs to another workspace
- The partial unique index: duplicate email refused, several null emails fine
- Cross-workspace and cross-organization isolation on every route
- Permission enforcement: a member may read but not write
- Cascades: customer deletion removes notes; author deletion nulls the author

## Security considerations

- `WorkspaceGuard` runs after `OrgGuard` and confirms the workspace belongs to
  the resolved organization, so a workspace id alone grants nothing
- Every query filters on `workspace_id`, never on the record id alone
- The search term is escaped for `LIKE` before it reaches the query, so a
  search for `%` finds records containing a percent sign rather than all of them
- Pagination cursors are record ids, validated as UUIDs and filtered by
  workspace, so a cursor cannot walk into another tenant's data
- `value_cents` is an integer of minor units. Money is never a float.

## Performance considerations

- Keyset pagination on `(workspace_id, id)`, so page one thousand costs what
  page one costs
- `limit` is capped at 100 regardless of what is asked for
- Search is `ILIKE` over three columns, which is a scan within a workspace;
  fine at a one-person company's scale, and the point at which it stops being
  fine is the point to add a trigram index
