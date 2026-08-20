# TASK-015 — Dashboard

Phase 5. Depends on TASK-012. Approved decisions: the browser talks only to the
Next app, which forwards to the API server-side; pages fetch in server
components using the incoming cookie; scope is login, the shell and the
dashboard.

The first frontend work since TASK-001, which shipped a placeholder page.

## Goal

The sketch this project started from, on screen, with real numbers.

## Scope

- A server-side API client that forwards the session cookie
- `/api/[...path]` — a proxy route so the browser never addresses the API
  directly, relaying `Set-Cookie` on the way back
- `/login` — sign in, with errors that say something useful
- Middleware redirecting an unauthenticated visitor to `/login`, and a signed-in
  one away from it
- `/` — the dashboard: revenue, MRR, customers, active users, AI cost,
  infrastructure, gross profit, margin
- Sign out
- Money and percentage formatting from micro-dollars and basis points

## Non-goals

- Customer, product, invoice or workflow screens. Offered and declined.
- Charts. The series endpoint exists; drawing it is not this task.
- Workspace switching. The first workspace is used.
- Registration through the UI. Accounts are made through the API for now.
- Dark mode beyond what the existing tokens already give.

## Database changes

None.

## API changes

None. The frontend consumes what TASK-012 and TASK-003 already expose.

## UI changes

Everything in this task.

- `/login` — email and password, one error line, no field-level noise
- `/` — a header with the organization and a sign-out control, then the metric
  tiles in the order the sketch had them
- Numbers are formatted at the edge, never stored formatted

## Acceptance criteria

- An unauthenticated request to `/` redirects to `/login`, and a signed-in
  visitor to `/login` is sent to `/`
- Signing in sets the session cookie on the app's own origin and lands on the
  dashboard
- Wrong credentials show one message that does not say whether the email exists
- The dashboard renders real figures from the API on first paint, with no
  client-side loading state
- The session token never appears in client JavaScript, in the HTML, or in any
  response body
- Money renders from micro-dollars — `2_100_000_000` shows as `$2,100` — and
  margin from basis points, with `—` when it is null
- A workspace with nothing in it renders zeroes rather than breaking
- `yarn verify` passes, and the frontend has tests

## Tests

- Formatting: micro-dollars to currency, basis points to a percentage, the
  null-margin case, and zero
- The proxy: forwards the cookie, relays `Set-Cookie`, refuses a path outside
  the API
- Login form: submits, shows an error, disables while pending
- The dashboard rendering a full set of figures and an empty one
- Middleware redirecting both ways

## Security considerations

- The browser never receives the API's address, so the session cookie stays on
  one origin and CSP keeps `connect-src 'self'`
- The proxy forwards a fixed allowlist of headers rather than everything, so a
  client cannot smuggle one through
- The proxy refuses to construct a URL outside the configured API base
- The session cookie remains httpOnly; nothing in the browser can read it
- Server components hold the cookie; it is never serialised into the page

## Performance considerations

- One round trip per page, server-side, on the same host
- The dashboard is dynamic by necessity — it is per-session data — so it is
  explicitly not cached
