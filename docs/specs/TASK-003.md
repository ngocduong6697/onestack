# TASK-003 — Authentication

Phase 1. Depends on TASK-002. Approved decisions: database-backed sessions in
an httpOnly cookie, argon2id password hashing, backend only.

## Goal

A person can create an account, prove who they are, and stop being logged in —
with revocation that takes effect immediately and nothing in the database that
would let an attacker who reads it log in as anyone.

## Scope

- `users` and `sessions` tables on TASK-002's conventions
- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Opaque 256-bit session token in an httpOnly cookie; only its SHA-256 is stored
- argon2id hashing at OWASP's minimum parameters
- `SessionGuard` and a `@CurrentUser()` decorator for every later feature
- `ZodValidationPipe` so rule 6 has one implementation, not one per controller
- Throttling on the auth routes, because unlimited login attempts are the
  cheapest attack there is

## Non-goals

- Password reset and email verification. Both need an email provider, and none
  is configured; they land with the first task that ships email.
- OAuth, SSO, MFA. Phase 6 at the earliest.
- Roles and permissions (TASK-004), profile management (TASK-005).
- Login UI. TASK-015 owns screens.

## Database changes

Migration `0001_users_sessions`, with a down migration dropping both tables.

`users`

| Column                      | Type        | Notes                                       |
| --------------------------- | ----------- | ------------------------------------------- |
| `id`                        | uuid        | UUIDv7, application-generated               |
| `email`                     | citext      | unique; citext is why TASK-002 installed it |
| `password_hash`             | text        | argon2id encoded string, never the password |
| `name`                      | text        | not null, trimmed, 1–100 chars              |
| `status`                    | text        | `active` or `disabled`, default `active`    |
| `last_login_at`             | timestamptz | null until first login                      |
| `created_at` / `updated_at` | timestamptz | from the shared conventions                 |

`sessions`

| Column                      | Type        | Notes                                         |
| --------------------------- | ----------- | --------------------------------------------- |
| `id`                        | uuid        | UUIDv7                                        |
| `user_id`                   | uuid        | FK to `users`, `on delete cascade`            |
| `token_hash`                | text        | unique, SHA-256 of the token the client holds |
| `expires_at`                | timestamptz | 30 days from issue                            |
| `last_seen_at`              | timestamptz | touched on use, for TASK-014                  |
| `user_agent`                | text        | nullable, truncated to 400 chars              |
| `created_at` / `updated_at` | timestamptz | conventions                                   |

Indexes on `sessions.user_id` (revoke-all-for-user) and `sessions.expires_at`
(cleanup). `users.email` is unique, which indexes it.

## API changes

| Endpoint              | Body                  | Returns                                   |
| --------------------- | --------------------- | ----------------------------------------- |
| `POST /auth/register` | email, password, name | 201, the user, sets cookie                |
| `POST /auth/login`    | email, password       | 200, the user, sets cookie                |
| `POST /auth/logout`   | —                     | 204, clears cookie, deletes session       |
| `GET /auth/me`        | —                     | 200 the user, 401 without a valid session |

No endpoint ever returns `password_hash`. A `PublicUser` type in `shared` is
the only shape that crosses the wire, so the field cannot leak by accident.

## UI changes

None.

## Acceptance criteria

- Registering twice with the same email returns 409, not a 500 from the unique
  index, and is case-insensitive: `A@b.test` collides with `a@b.test`
- Login with a wrong password and login with an unknown email are
  indistinguishable — same status, same message, same shape
- `GET /auth/me` returns 401 with no cookie, a garbage cookie, an expired
  session, or a session whose user is `disabled`
- Logout deletes the session row, so the cookie is worthless afterwards even
  if it was captured
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production
- The database never holds a password or a usable session token
- Exceeding the login throttle returns 429
- `yarn verify` passes

## Tests

- argon2id: hash then verify round-trips; a wrong password fails; two hashes of
  the same password differ; the hash is not the password
- Session tokens: 256 bits of entropy, distinct across a burst, the stored
  value is the digest and never the token
- Integration against real Postgres: register, duplicate email, case-insensitive
  duplicate, login, wrong password, unknown email, me, logout, reuse after
  logout, expired session, disabled user
- HTTP level with supertest: cookie flags, status codes, 401 shapes, that no
  response body carries `password_hash`
- `ZodValidationPipe` rejects a malformed body with 422 and names the field

## Security considerations

- argon2id at OWASP minimums: 19 MiB memory, 2 iterations, parallelism 1
- Only a SHA-256 of the session token is stored. SHA-256 rather than argon2 is
  correct here: the token is already 256 random bits, so it has no guessable
  structure to slow an attacker down over, and the lookup is on the hot path
- Login compares against a dummy hash when the email is unknown, so response
  timing does not reveal which accounts exist
- Session tokens come from `crypto.randomBytes`, never `Math.random`
- Sessions are compared by digest lookup, not by any user-supplied identifier
- The cookie is httpOnly, so XSS cannot read it; SameSite=Lax blunts CSRF on
  state-changing routes, and rule 5 keeps the token out of any response body
- Rate limits: 5 login attempts and 3 registrations per minute per IP
- Password minimum 12 characters, maximum 200 — the maximum matters because
  argon2 will happily burn CPU on a megabyte of input

## Performance considerations

- One indexed lookup on `token_hash` per authenticated request, which is the
  cost the approved design accepts
- `last_seen_at` is written at most once a minute per session, not on every
  request, so a read-heavy page does not become a write-heavy one
- argon2id at 19 MiB is deliberately slow (~50ms); only login and register pay
  it, never an authenticated request
