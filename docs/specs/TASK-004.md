# TASK-004 — Organization / Workspace

Phase 1. Depends on TASK-003. Approved decisions: organizations own
workspaces with membership at the organization level, application-level
scoping behind a guard, the organization named in the URL path, and roles
included but member management deferred.

## Goal

Every row the business will ever store belongs to someone. This task creates
that owner, the subdivision beneath it, and the guard that makes reaching
across the boundary a 404 rather than a leak.

## Scope

- `organizations`, `workspaces`, `memberships` on TASK-002's conventions
- Roles `owner`, `admin`, `member`, ranked so checks read as "admin or above"
- `OrgGuard` resolving membership from the path, plus `@CurrentOrg()` and
  `@RequireRole()`
- CRUD for organizations and workspaces, all scoped
- Registration creates a personal organization and a default workspace, so
  nobody logs in to an empty account with nowhere to put anything
- Slugs generated from names, unique per scope

## Non-goals

- Invitations and member management — listing, role changes, removal. The
  first needs email; the rest belongs to TASK-005.
- Per-workspace permissions. Org membership grants every workspace, and the
  membership table is shaped so this can change without moving data.
- Row-level security. Considered and declined; revisit in Phase 6 as defence
  in depth, not as a replacement for the guard.
- Deleting an organization. It cascades to everything the company owns, so it
  needs a confirmation flow and a retention policy, not a DELETE route.

## Database changes

Migration `0002_organizations_workspaces`, reversible.

`organizations` — `id`, `name` (1–100), `slug` (unique, lowercase), timestamps.

`workspaces` — `id`, `organization_id` FK cascade, `name`, `slug`, timestamps.
`(organization_id, slug)` unique: two organizations may both have `general`.

`memberships` — `id`, `organization_id` FK cascade, `user_id` FK cascade,
`role`, timestamps. `(organization_id, user_id)` unique, so a person cannot
hold two roles in one organization. Indexed on `user_id` for "my orgs".

## API changes

| Endpoint                             | Role     | Returns                                             |
| ------------------------------------ | -------- | --------------------------------------------------- |
| `POST /orgs`                         | any user | 201, the org, caller becomes `owner`                |
| `GET /orgs`                          | any user | 200, organizations the caller belongs to, with role |
| `GET /orgs/:orgId`                   | member   | 200, or 404 if not a member                         |
| `PATCH /orgs/:orgId`                 | admin    | 200                                                 |
| `POST /orgs/:orgId/workspaces`       | admin    | 201                                                 |
| `GET /orgs/:orgId/workspaces`        | member   | 200                                                 |
| `PATCH /orgs/:orgId/workspaces/:id`  | admin    | 200                                                 |
| `DELETE /orgs/:orgId/workspaces/:id` | admin    | 204                                                 |

Non-membership returns **404, not 403**. A 403 confirms the organization
exists, which tells an attacker enumerating ids something true.

## UI changes

None.

## Acceptance criteria

- A member of organization A gets 404 for every route under organization B,
  including ones that would otherwise 200, and including workspace ids that
  really exist inside B
- A `member` gets 403 on admin routes; an `owner` passes every `admin` check
- Registering creates exactly one organization and one workspace, and the
  registrant is its `owner`
- Slugs are unique per scope, and a colliding name gets a suffix rather than
  an error
- A workspace id from another organization is 404 even when the caller is an
  admin of their own
- Deleting an organization row removes its workspaces and memberships, and
  deleting a user removes their memberships but leaves the organization
- `yarn verify` passes

## Tests

- Slug generation: lowercases, strips punctuation, collapses spaces, truncates,
  and suffixes on collision
- Role ranking: `owner` satisfies `admin`, `member` does not
- Integration: create, list-mine, membership auto-creation on register, and
  every cross-tenant path returning 404
- HTTP: the full route table with a member, an admin, an owner and an outsider;
  that a workspace id from another org is 404; that a `member` hitting an admin
  route is 403
- Cascades: deleting an org, deleting a user

## Security considerations

- The guard resolves membership on every request from the path parameter; no
  route may read `orgId` without it
- Cross-tenant reads are indistinguishable from missing rows (404)
- Workspace lookups are always filtered by the resolved organization, never by
  id alone, so a valid id from another tenant finds nothing
- Role checks happen in the guard, not in handlers, so a new route cannot
  forget one — it fails closed without `@RequireRole`
- Names are bounded and slugs are generated, never taken from user input, so a
  slug cannot be crafted to collide with a route

## Performance considerations

- One membership lookup per scoped request, on the `(organization_id, user_id)`
  unique index
- `GET /orgs` joins memberships to organizations on the `user_id` index
- Slug collision resolution costs one extra query only when a name repeats
