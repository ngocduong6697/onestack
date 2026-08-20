# TASK-014 — Audit logs

Cross-cutting, sequenced here. Approved decisions: recorded explicitly at the
service layer, carrying action, resource, actor and the fields that changed,
covering a named list of important actions.

This is CLAUDE.md rule 7, deferred by five review gates and now due.

## Goal

Answer "who did this, and when" for the actions that matter — including the
ones a workflow did at three in the morning with nobody logged in.

## Scope

- `audit_events`, organization-scoped
- A catalogue of named actions in one file, so what is covered can be read
- `AuditService.record`, which never throws
- Recording wired into auth, membership, invitations, billing, deletions and
  workflow runs
- `GET .../audit` — the log, filterable and paginated

## Non-goals

- Auditing every mutation. Offered and declined; the signal drowns.
- Before-and-after snapshots. Declined: it makes the audit table a second copy
  of every table, including the columns the originals protect.
- Tamper-proofing — hash chains, append-only storage, external shipping. That
  is a Phase 6 concern and a different threat model.
- Retention and archival.
- A UI.

## Database changes

Migration `0011_audit_events`, reversible.

`audit_events` — `id`, `organization_id` FK cascade, `workspace_id` FK set
null, `actor_user_id` FK **set null**, `actor_label` (text),
`action`, `resource_type`, `resource_id`, `changes` (jsonb, nullable),
`context` (jsonb, nullable — IP and user agent), timestamps.

Scoped to the **organization**, not the workspace: signing in and changing a
member's role are organization-level facts that happen outside any workspace.
`workspace_id` is present when there is one.

`actor_user_id` is `set null` and `actor_label` holds a copy of the name at
the time. Deleting a person must not erase what they did, and a null actor
with no label would be an audit entry that answers nothing.

Indexed on `(organization_id, created_at)` and `(organization_id, id)`.

## API changes

| Endpoint                 | Permission   | Notes                                                        |
| ------------------------ | ------------ | ------------------------------------------------------------ |
| `GET /orgs/:orgId/audit` | `audit:read` | `action`, `resourceType`, `actorId`, `from`, `to`, paginated |

Organization-scoped rather than workspace-scoped, matching the table. Only
admins and owners may read it — a member should not see who removed whom.

## UI changes

None.

## Acceptance criteria

- Recording never throws and never fails the action being audited. An audit
  write that breaks a payment is worse than a missing entry
- A failed audit write is logged loudly rather than silently swallowed
- Every action in the catalogue is a named constant; a typo is a type error
- Entries survive the actor being deleted, keeping the label
- No entry contains a password hash, a session or invite token, an API key, or
  a prompt — asserted directly rather than assumed
- A workflow run produces an entry with a system actor and no user
- Auth events are recorded with the organization the user belongs to
- The log is readable by admins and owners only, and is workspace-blind
- Cross-tenant reads return 404
- `yarn verify` passes

## Tests

- The recorder: writes what it was given, survives a database failure,
  redacts sensitive keys
- Every catalogued action appears at least once in the codebase, so the
  catalogue and the wiring cannot drift apart
- Login, role change, invitation accepted, invoice paid, customer deleted and
  a workflow run each producing an entry
- A member refused, an admin allowed
- Actor deletion leaving the entry with its label

## Security considerations

- The audit log is the record of who did what: it is written by the services
  and never edited or deleted through the API
- `changes` passes through a redactor that drops known-sensitive keys —
  password, hash, token, secret, key, prompt — before storage
- Reading is admin-and-above, because the log itself is sensitive
- Recording is best-effort by design: it must never be able to fail a
  business action, which also means a gap is possible and is logged

## Performance considerations

- One insert per audited action, on paths that already write
- Reading is one indexed range scan on `(organization_id, created_at)`
