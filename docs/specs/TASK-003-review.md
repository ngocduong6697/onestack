# Review gates — TASK-003

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0001_users_sessions.sql` and its `.down.sql`;
`backend/src/database/schema/users.ts` and `sessions.ts`;
`backend/src/auth/` (module, controller, service, password, tokens, guard,
`@CurrentUser`, tests); `backend/src/common/zod-validation.pipe.ts`;
`shared/src/auth.ts` (request schemas and the `PublicUser` shape).
Modified: `backend/src/app.module.ts`, `backend/src/main.ts` (cookie parsing),
`backend/src/config/env.ts` (session lifetime, cookie domain),
`backend/src/database/schema/index.ts`, `backend/package.json`, `.env.example`,
`README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
One migration creating `users` and `sessions`, reversible by dropping them in
dependency order. It is also the first migration to use `citext`, which means
`0000_extensions.down.sql` stops being runnable from here on — expected, and
already documented in that file.

**3. What APIs are affected?**
None existing. Four added under `/auth`. `/health` and `/ready` stay
unauthenticated: a probe that needs a session is a probe that fails during an
outage for the wrong reason.

**4. What existing behavior could regress?**
Three risks. Registering `cookie-parser` and the throttler as global middleware
touches every route, including the probes — mitigated by asserting `/health`
and `/ready` still answer without a cookie. Adding a global validation pipe
could reject existing requests — mitigated because the pipe only acts on
routes that declare a schema. And the guard must be opt-in rather than global,
or every future endpoint silently requires a session before it is ready to.

**5. What tests are needed?**
Unit: argon2id round-trip and rejection, token entropy and digest storage,
validation pipe. Integration against real Postgres: the full register/login/
me/logout lifecycle plus every rejection path — duplicate email, case-only
duplicate, wrong password, unknown email, expired session, disabled user,
reuse after logout. HTTP: cookie flags, status codes, and an explicit assertion
that no response body anywhere contains `password_hash`.

**6. Are there simpler alternatives?**
Passport with `passport-local` is the Nest default and would replace the
service with configuration. Rejected: it adds three dependencies and a strategy
abstraction to wrap roughly forty lines of logic, which is the "no unnecessary
abstractions" line in CLAUDE.md. Storing the session token in plain text would
remove one hash per request; rejected because it turns a database read into
account takeover. Skipping the dummy-hash comparison on unknown emails would
be simpler and would leak which accounts exist through response timing.

## After implementation

**1. What changed?**
New `backend/src/auth/`: `password.ts` (argon2id + the timing-equalising dummy
verify), `tokens.ts` (token generation, digesting, constant-time compare),
`auth.service.ts`, `auth.controller.ts`, `session.guard.ts`,
`current-user.decorator.ts`, `session-cookie.ts`, `auth.module.ts`. New
`backend/src/common/zod-validation.pipe.ts`, `backend/src/database/schema/users.ts`
and `sessions.ts`, `shared/src/auth.ts`, and migration `0001_users_sessions`
with its down file. Modified: `app.module.ts` (AuthModule, global throttler),
`main.ts` (cookie-parser), the schema barrel, the shared barrel,
`.env.example`, `README.md`, `docs/BACKLOG.md`.

drizzle-kit numbered its output `0000` because its journal cannot see the
hand-written extensions migration. Renamed to `0001` and the journal's index
corrected, so the next `generate` continues at `0002` rather than colliding.

**2. What tests were added?**
36, taking the suite from 35 to 71. Unit: argon2id (round-trip, rejection,
salting, corrupt-hash denial, never stores the password), session tokens
(entropy, uniqueness across 1000, URL-safety, digest-not-token, determinism,
constant-time compare), and the validation pipe. Integration against real
Postgres: 16 covering register, duplicate, case-insensitive duplicate, login,
last_login_at, identical rejection of wrong password and unknown email,
disabled accounts, forged and expired sessions, logout, purge, and FK cascade.
Over HTTP with supertest: 18 covering cookie flags, status codes, four
validation rejections, that no body carries the hash or the token, and that
the probes still answer without a session. Plus one that the login throttle
returns 429.

**3. What tests were run?**
`yarn verify` — 71 backend, 7 shared, 9 frontend — on both Node 24 locally and
Node 22 from a clean checkout with a frozen install, matching CI. Also
verified by hand against a running API: register returned 201 with an HttpOnly
cookie; `/auth/me` 200 with it and 401 without; registering the same address
lowercased returned 409, proving citext; wrong password and unknown email
returned byte-identical 401s; a short password returned 422 naming the field;
logout returned 204, the cookie stopped working, and the session table went to
zero rows; and the stored `password_hash` begins `$argon2id$v=19$m=19456`.

The timing claim was measured rather than asserted. A first attempt over 12
samples on an unwarmed process suggested a 4 ms gap; with a warm process and
40 interleaved samples each, the medians were 12.7 ms for a known email and
13.0 ms for an unknown one — a 0.31 ms gap, which is noise.

**4. Any known limitations?**

- No password reset and no email verification, so an address is unproven and a
  forgotten password is unrecoverable. Both need an email provider.
- Sessions expire but nothing sweeps them. `purgeExpiredSessions` exists and is
  tested; TASK-011's scheduler is what will call it.
- The throttler counts in memory, so limits are per process. More than one API
  container multiplies the effective limit; Phase 6 wants shared storage.
- Rate limits key on IP. Behind a proxy every request looks like one client
  until `trust proxy` is configured in TASK-018.
- `THROTTLE_DISABLED` exists for tests. It is ignored when `NODE_ENV` is
  production, but it is still a flag that turns off a security control.
- Still unverified since TASK-001: `docker compose up --build`, no daemon here.

**5. Any technical debt?**

- `AuthController` calls `loadEnv()` per instance to read cookie settings;
  a config provider would be tidier once a second consumer appears.
- No CSRF token. SameSite=Lax covers the common cases but not everything, and
  a form-post endpoint added later will need more.
- Sessions do not record an IP, only a truncated user agent, which limits what
  TASK-014 can show on a "where am I logged in" screen.
- `authenticate` issues two queries when it touches `last_seen_at`. Fine at
  one write per minute per session, worth a single statement if it grows.

**6. Does this follow CLAUDE.md?**

- Rule 1 — sessions, hashing and scope were approved before code.
- Rule 2 — three dependencies: `@node-rs/argon2` (the approved hashing, with
  prebuilt binaries so Docker needs no toolchain), `cookie-parser` (the cookie
  is the transport), `@nestjs/throttler` (already the house choice).
- Rule 3 — request shapes and `PublicUser` are defined once, in `shared`.
- Rule 4 — no UI.
- Rule 5 — the token exists in a body never, the hash leaves the database
  never, and an unknown error still returns an opaque 500.
- Rule 6 — every endpoint with a body validates through one pipe.
- Rule 7 — partially. Registration and login are logged, `last_login_at` and
  `sessions.last_seen_at` are recorded, but there is no audit table until
  TASK-014, which is where auth events should land.
- Rule 9 — the migration is reversible and the guard test proves it.
- Rule 10 — every module added ships with tests.
  Rule 8 has nothing to bind to yet.
