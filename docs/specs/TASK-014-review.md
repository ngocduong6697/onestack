# Review gates — TASK-014

## Before implementation

**1. What files will change?**
New: migration `0011_audit_events`, `backend/src/database/schema/audit.ts`,
`backend/src/audit/` (action catalogue, redactor, service, controller, module,
tests). Modified: `auth.service.ts`, `members.service.ts`,
`invitations.service.ts`, `customers.service.ts`, `billing.service.ts`,
`automation/runner.ts` and the controllers that must pass an actor through;
`permissions.ts`, `app.module.ts`, `README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
One table, scoped to the organization rather than a workspace, because signing
in and changing a role happen outside any workspace. `actor_user_id` is
`set null` with `actor_label` holding the name at the time — a null actor with
no label is an entry that answers nothing.

**3. What APIs are affected?**
One route added. Several services gain an optional actor parameter, which
changes no response.

**4. What existing behavior could regress?**
Six services are edited, three of which handle money or membership. The risk
is an audit write failing an action that would otherwise have succeeded, which
is why `record` cannot throw. The second risk is quieter: a patch that does
not apply leaves an action unaudited and everything still passing — so each
wired action has a test asserting the entry exists.

**5. What tests are needed?**
The redactor against the key shapes that actually appear — `passwordHash`,
`tokenHash`, `ANTHROPIC_API_KEY`. The recorder surviving a database failure.
One end-to-end test per wired action, because "we wired it" is exactly the
claim that silently stops being true. A workflow run producing a system-actor
entry, since that is the case an interceptor could not have covered. And the
log refusing a member.

**6. Are there simpler alternatives?**
An interceptor on mutating routes needs no per-action work and would miss
every change automation makes. Database triggers would catch even manual SQL
and put the rules outside the codebase. Recording only security events was
offered and would not say who voided an invoice.

## After implementation

**1. What changed?**
New `backend/src/audit/`: `actions.ts` (the catalogue, 21 named actions),
`redact.ts`, `audit.service.ts`, `audit.controller.ts`, `audit.module.ts`
(global, like the database). New `audit_events` and migration
`0011_audit_events`. Recording wired into registration, login, role changes,
member removal, invitations created and accepted, invoice issued and paid and
voided, customer deletion, and workflow runs.

`audit:read` is granted to admin and owner only, deliberately not to member:
the log says who removed whom.

**2. What tests were added?**
39, taking the suite from 553 to 592. The redactor has 19, naming each
sensitive key shape. The recorder has 6, including surviving a database
failure and a synchronous throw. End-to-end has 13, one per wired action plus
the access-control and actor-deletion cases.

**3. What tests were run?**
`yarn verify` passes — 592 backend, 7 shared, 9 frontend. Against a running
API the trail read:

```
Owner           auth.registered      user
Owner           invite.created       invitation  {"role":"member","email":"mate@…"}
invited member  invite.accepted      invitation  {"role":"member"}
Owner           member.role_changed  membership  {"to":"admin","from":"member"}
Owner           auth.login           user
```

A member was refused with 403 and an admin allowed. A query for
`argon2|token|password` across every `changes` value returned 0 rows. Deleting
the owner left six rows with four null actors and their labels intact.

**Two bugs were caught by tests during the work.** A patch wiring the member
removal silently failed to apply — prettier had reformatted the anchor — so
removal went unaudited while everything still passed; the end-to-end test for
it is what surfaced that. And the permission map test did _not_ fire when
`audit:read` was added, because its admin assertion sampled rather than
enumerated; it now compares the admin grant to the full catalogue, so the next
addition cannot slip past unnamed.

**4. Any known limitations?**

- The catalogue names 21 actions and 11 are wired. Product deletion, price
  archiving, workspace and workflow deletion, subscription cancellation,
  invitation revocation, ledger deletion and password change are named but not
  yet recorded — the constants exist, the call sites do not.
- Nothing enforces that a catalogued action is wired. A test asserting each
  constant appears somewhere in the source would close it and does not exist.
- No tamper-proofing: rows can be deleted by anything with database access.
  Hash chaining or shipping elsewhere is a Phase 6 concern.
- No retention policy; the table grows forever.
- `context` — IP and user agent — is on the table and never populated.
- Auth events are filed against every organization the person belongs to,
  which for somebody in several would write several rows for one login.

**5. Any technical debt?**

- Actor plumbing is repetitive: each controller assembles
  `{ userId, label, organizationId }` by hand. A decorator returning an
  `AuditActor` would remove most of it.
- Several services take an _optional_ actor, so forgetting to pass one is
  silently unaudited rather than a type error. It should be required.
- `AuthService.auditForUser` loads the person's organizations on every login.

**6. Does this follow CLAUDE.md?**

- Rule 1 — capture mechanism, contents and coverage were approved first.
- Rule 2 — no new dependencies.
- Rule 3 — redaction happens once, centrally, so no call site can forget.
- Rule 4 — no UI.
- Rule 5 — the log holds no secret, asserted by query as well as by test, and
  reading it requires admin.
- Rule 6 — the query string validates through the pipe.
- Rule 7 — **now met for the actions that are wired**, with the gaps listed
  above rather than implied.
- Rule 9 — the migration is reversible and tested.
- Rule 10 — every module added ships with tests.
