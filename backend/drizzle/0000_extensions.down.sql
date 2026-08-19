-- Reversible only while nothing depends on these, which is true exactly now:
-- this migration runs before any table exists. Once a citext column ships,
-- this down migration will fail on purpose rather than drop data with CASCADE.
DROP EXTENSION IF EXISTS citext;
--> statement-breakpoint
DROP EXTENSION IF EXISTS pgcrypto;
