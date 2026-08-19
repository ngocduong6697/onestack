-- Extensions every later migration is allowed to assume.
--
-- pgcrypto: gen_random_uuid() as a server-side fallback for rows this
-- application does not create, and digest()/crypt() for TASK-003.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
-- citext: case-insensitive text, so an email column can be unique without a
-- functional index and a lower() call on every lookup.
CREATE EXTENSION IF NOT EXISTS citext;
