# TASK-005 — User management

Phase 1. Depends on TASK-004. Approved decisions: joining by single-use invite
token shared out-of-band, named permissions mapped from roles, and a scope
covering profile, password, members and invites.

## Goal

An organization stops being one person. Somebody can be invited, join, be
promoted, be removed — and can manage their own name and password without a
database edit.

## Scope

- A permission catalogue and a role→permissions map, with `@RequirePermission()`
- `invitations` table; create, list, revoke, accept
- Member listing, role changes, removal
- Self-service: read profile, rename, change password
- The last owner is protected from demotion and removal

## Non-goals

- Email delivery. The invite endpoint returns a token to hand over yourself;
  when a provider exists, the same endpoint sends it.
- Changing an email address, which needs verification, and deleting an account,
  which needs a retention policy.
- Per-membership permission overrides. The map is the whole model.
- Any UI.

## Database changes

Migration `0003_invitations`, reversible.

`invitations` — `id`, `organization_id` FK cascade, `email` (citext),
`role`, `token_hash` (unique), `invited_by` FK to users `on delete set null`,
`expires_at`, `accepted_at` (null until used), timestamps.
Unique on `(organization_id, email)` **where `accepted_at is null`** — a
partial index, so one open invite per address per organization while still
allowing a fresh invite after a previous one was accepted.
Indexed on `token_hash` for lookup at accept time.

`invited_by` is `set null` rather than cascade: an invitation is a record of
something that happened, and it should survive the inviter leaving.

## API changes

| Endpoint                              | Permission      | Notes                                 |
| ------------------------------------- | --------------- | ------------------------------------- |
| `GET /users/me`                       | session         | The caller                            |
| `PATCH /users/me`                     | session         | Name only                             |
| `POST /users/me/password`             | session         | Current + new; revokes other sessions |
| `GET /orgs/:orgId/members`            | `member:read`   | Members with roles                    |
| `PATCH /orgs/:orgId/members/:userId`  | `member:update` | Change role                           |
| `DELETE /orgs/:orgId/members/:userId` | `member:remove` | Remove, or leave                      |
| `POST /orgs/:orgId/invites`           | `invite:create` | Returns the token once                |
| `GET /orgs/:orgId/invites`            | `invite:read`   | Open invites, never tokens            |
| `DELETE /orgs/:orgId/invites/:id`     | `invite:revoke` |                                       |
| `POST /invites/:token/accept`         | session         | Joins the caller                      |

The token is returned exactly once, at creation. Listing invites returns their
email, role and expiry — never a token, because a stored token that can be
re-read is a stored password.

## UI changes

None.

## Acceptance criteria

- The last owner of an organization cannot be demoted or removed, by anyone,
  including themselves — the organization can never become ownerless
- An admin cannot promote themselves to owner, and cannot change an owner's role
- Changing a password revokes every other session but keeps the current one
- A wrong current password fails the change, and does not reveal anything else
- An invite is single-use: accepting it twice fails the second time
- An expired invite fails; a revoked invite fails; a token for another
  organization is not accepted anywhere else
- Accepting an invite while already a member fails rather than duplicating
- Invite tokens are stored hashed, exactly like session tokens
- A member can remove themselves (leave), and that is the only removal a
  `member` may perform
- `yarn verify` passes

## Tests

- The permission map: every role's grants, and that an unknown permission is a
  type error rather than a silent allow
- Last-owner protection from three directions: demoting, removing, and leaving
- Password change: success, wrong current password, other sessions revoked,
  current session survives
- Invites: create, accept, double-accept, expired, revoked, wrong organization,
  already a member, and that the token is never returned by the list endpoint
- Role changes: admin cannot touch an owner, admin cannot self-promote
- Cross-tenant: every member and invite route is 404 for an outsider

## Security considerations

- Invite tokens are 256-bit random values stored as SHA-256, like sessions
- An invite names an email, and accepting is bound to the caller's session
  rather than to the email in the token, so a leaked token cannot be redeemed
  into someone else's account — but it can be redeemed by whoever holds it,
  which is why it is single-use and short-lived
- Changing a password requires the current one, so a stolen session cannot
  lock the owner out silently
- Password change revokes other sessions, which is the actual remedy after a
  session is stolen
- Role escalation is blocked at the service layer, not only in the UI: an
  admin cannot grant a role above their own
- Member and invite routes are scoped by `OrgGuard`, so cross-tenant access is
  404 exactly as in TASK-004

## Performance considerations

- Member listing is one join on the `(organization_id, user_id)` index
- Invite acceptance is one indexed lookup on `token_hash`
- Last-owner checks count owners in one query, only on the paths that could
  remove one
