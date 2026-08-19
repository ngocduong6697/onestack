# Review gates — TASK-005

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0003_invitations.sql` and its `.down.sql`;
`backend/src/database/schema/invitations.ts`;
`backend/src/orgs/permissions.ts` and `members.controller.ts`,
`invitations.controller.ts`, `members.service.ts`, `invitations.service.ts`;
`backend/src/users/` (controller, service, tests); `shared/src/users.ts`.
Modified: `org.guard.ts` (honour `@RequirePermission` alongside
`@RequireRole`), `orgs.module.ts`, `app.module.ts`, both barrels, `README.md`,
`docs/BACKLOG.md`.

**2. What database changes are required?**
One table. The subtle part is the uniqueness rule: one _open_ invite per email
per organization, which is a partial unique index on `accepted_at is null`
rather than a plain unique constraint — a plain one would block re-inviting
somebody who left. `invited_by` is `set null` so the record outlives the
inviter.

**3. What APIs are affected?**
Ten routes added. `GET /auth/me` is unaffected but now overlaps
`GET /users/me`; the auth one stays as the session probe and the users one is
where profile lives. Nothing existing changes shape.

**4. What existing behavior could regress?**
Two risks. `OrgGuard` gains permission checking, so a mistake there affects
every scoped route written in TASK-004 — mitigated by keeping `@RequireRole`
working unchanged and asserting the TASK-004 tests still pass untouched.
Password change revokes sessions, and revoking too broadly would log the caller
out of their own request — asserted directly.

**5. What tests are needed?**
The permission map, exhaustively, because it is the thing every route now
depends on. Last-owner protection from all three directions, since each is a
different code path to the same invariant. The full invite lifecycle including
every failure: double-accept, expired, revoked, wrong organization, already a
member. Password change including that other sessions die and the current one
does not. And the cross-tenant 404 sweep extended to the new routes.

**6. Are there simpler alternatives?**
Keeping `@RequireRole` everywhere and skipping permissions entirely — offered
and declined, and it is the option that ages worst. Storing invite tokens in
plain text would let the list endpoint show a resend link; rejected for the
same reason session tokens are hashed. Letting anyone accept an invite by
email match rather than by holding the token would remove the token table
entirely, and would let anybody join any organization by guessing an address.

## After implementation

**1. What changed?**
New `backend/src/orgs/`: `permissions.ts`, `members.service.ts`,
`invitations.service.ts`, `members.controller.ts`, `invitations.controller.ts`,
`accept-invite.controller.ts`. New `backend/src/users/` (service, controller,
module). New `invitations` schema and migration `0003_invitations` with its
down file, and `shared/src/users.ts`. Modified: `org.guard.ts` (permissions
alongside roles), `current-org.decorator.ts` (`@RequirePermission`),
`orgs.module.ts`, `app.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`.

Accepting an invitation lives at `/invites/:token/accept`, outside
`/orgs/:orgId`, because the token names the organization and the person
accepting is by definition not yet a member — `OrgGuard` would refuse them.

**2. What tests were added?**
37, taking the suite from 107 to 144. The permission map (5), invitations (11:
token returned once and never listed, stored hashed, joining at the invited
role, single-use, expired, revoked, garbage, already a member, duplicate open
invite, admin cannot invite an owner, invisible cross-tenant), members (6),
last-owner protection (4: demote, remove, leave, and stepping down once a
second owner exists), and profile and password (10, including that other
sessions die while the caller's survives).

**3. What tests were run?**
`yarn verify` on Node 24 and on Node 22 from a clean frozen-install checkout —
144 backend, 7 shared, 9 frontend. Against a running API: an owner created an
invite and got a token; listing returned the invitation without it; the
database held `f254618553eed49b7dfc...` rather than the token; a second person
signed up and joined as admin; replaying the token returned 404; the admin was
refused when demoting the owner (403) and the owner was refused when demoting
themselves (409, "Cannot demote the last owner").

**4. Any known limitations?**

- No email, so an invite has to be delivered by hand. Anyone who obtains the
  token can join, which is why it is single-use and expires in seven days, but
  it is a bearer credential rather than proof of address.
- The invited email is a label, not a constraint: whoever holds the token joins,
  even if their account uses a different address.
- No email change and no account deletion.
- An organization with no owner is impossible to create, but one whose only
  owner loses their password is unrecoverable without a database edit — there
  is no reset flow yet.
- `@RequireRole` and `@RequirePermission` both exist. Roles remain on the
  TASK-004 routes; new routes use permissions. Two mechanisms is one more than
  necessary, and the old one should go once nothing needs it.
- Still unverified since TASK-001: `docker compose up --build`.

**5. Any technical debt?**

- The member removal route checks `member:remove` inside the handler rather
  than through the guard, because a member removing _themselves_ is allowed.
  That is the one place authorisation is not purely declarative.
- `MembersService.updateRole` re-lists the whole organization to return one
  member. Cheap at this size, wasteful later.
- `InvitationsService` reaches into `../auth/tokens` for token generation.
  Fine while both mean "a bearer credential", worth its own module if the two
  ever diverge.
- Owner and admin share a permission set, with their difference expressed as
  invariants in the service. That is correct but invisible from the map alone.

**6. Does this follow CLAUDE.md?**

- Rule 1 — joining mechanism, permission model and scope were approved first.
- Rule 2 — no new dependencies.
- Rule 3 — permissions live in one map; invite tokens reuse the session token
  primitives rather than a second implementation.
- Rule 4 — no UI.
- Rule 5 — the invite token is returned once and never readable again; listing
  builds its response field by field so a column added later cannot leak it.
- Rule 6 — every route with a body validates through the pipe.
- Rule 7 — partially, still. Role changes, removals and invitations are exactly
  the actions an audit log should hold, and TASK-014 is where they land.
- Rule 9 — the migration is reversible and the guard test proves it.
- Rule 10 — every module added ships with tests, and the invariants are tested
  from the attacker's side as well as the happy path.
