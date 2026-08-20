# Review gates — TASK-015

## Before implementation

**1. What files will change?**
New: `frontend/src/lib/api.ts` and `format.ts`, `frontend/src/middleware.ts`,
`frontend/src/app/api/[...path]/route.ts`, `frontend/src/app/login/`,
`frontend/src/app/dashboard-view.tsx`, `metric-tile.tsx`, `sign-out.tsx`, and
tests for each. Modified: `frontend/src/app/page.tsx` (was a placeholder),
`.env.example`, `README.md`, `docs/BACKLOG.md`. The TASK-001 placeholder test
is replaced rather than kept.

**2. What database changes are required?**
None.

**3. What APIs are affected?**
None. Everything consumed already exists.

**4. What existing behavior could regress?**
`NEXT_PUBLIC_API_URL` becomes `API_URL`, which the TASK-007 fix wired into the
CSP's `connect-src`. Since the browser no longer calls the API directly, that
directive should go back to `'self'` — if it silently kept an origin that no
longer matters, the policy would be looser than it needs to be. The middleware
matcher must exclude `/api`, or the proxy would redirect itself.

**5. What tests are needed?**
Formatting, because it is the last step before a number a person acts on and
the null-margin case has a wrong-looking right answer. The URL builder against
paths an attacker would supply. The middleware in both directions. And the
dashboard rendering a full set of figures and an empty one — which is why the
view is split from the fetching.

**6. Are there simpler alternatives?**
Calling the API directly from the browser is one hop fewer and needs CORS, a
cookie valid across two origins, and both hosts reachable from wherever the
page is open. Client-side fetching is more familiar and puts a loading state
in front of a read-only dashboard. Both were offered and declined.

## After implementation

**1. What changed?**
New `frontend/src/lib/api.ts` (server-side client and URL builder),
`format.ts`, `middleware.ts`, the `/api/[...path]` proxy, `/login` with a
client form, and the dashboard split into `page.tsx` (fetching) and
`dashboard-view.tsx` (rendering). `.env.example` now names `API_URL` rather
than `NEXT_PUBLIC_API_URL`.

The dashboard was split from its own page while writing its test: rendering
and fetching can be wrong independently, and "renders zeroes for an empty
workspace" is only assertable without a server, a session and a database if
the view is a pure function of its data.

**2. What tests were added?**
39, taking the frontend from 9 to 48. Formatting has 11, the URL builder and
result reader 12, the middleware 6, and the dashboard and tile 11.

**3. What tests were run?**
`yarn verify` passes — 592 backend, 7 shared, 48 frontend. The whole stack was
run together: an unauthenticated `/` returned 307 to `/login`; signing in
through `/api/auth/login` returned 200 and set an HttpOnly cookie on the app's
own origin; and the dashboard rendered

```
Revenue $2,100   MRR $2,100   Customers 18   Active 18
AI cost $0.00    Infrastructure $90          Subscriptions 1
Gross profit $2,010          Margin 96%
```

The security claims were checked rather than asserted: the 43-character
session token appears **0 times** in the rendered HTML, no token-shaped string
appears at all, and the API's address appears 0 times.

**4. Any known limitations?**

- **The CSP still names an API origin it no longer needs.** TASK-007 added
  `connect-src 'self' ${apiOrigin}` from `NEXT_PUBLIC_API_URL`, which is now
  unset — so it degrades to `'self'`, which is correct, but by accident rather
  than by decision. The `apiOrigin` code should go.
- The first organization and workspace are used, with no way to switch.
- No registration through the UI; accounts are made through the API.
- The series endpoint exists and nothing draws it — there is no chart.
- Nothing but the dashboard: no customer, product, invoice or workflow screens.
- The dashboard makes three sequential server-side calls where two could run
  in parallel.
- No frontend test exercises the proxy route itself; it is verified by the
  live run only.

**5. Any technical debt?**

- `page.tsx` handles three failure shapes with three `Empty` returns; an error
  boundary would be tidier.
- The proxy repeats four near-identical method handlers.
- `SignOut` is duplicated between the dashboard view and the empty state.

**6. Does this follow CLAUDE.md?**

- Rule 1 — transport, rendering and scope were approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — formatting is defined once and used by every tile.
- Rule 4 — the view is a pure function of its data; every figure is computed
  by the API, and the frontend only formats.
- Rule 5 — the session token never reaches the browser's JavaScript or HTML,
  the API's address is not published, and the proxy forwards an allowlist of
  headers rather than everything.
- Rule 6 — no new API surface; the login form's input is validated by the API.
- Rule 10 — every module added ships with tests.
