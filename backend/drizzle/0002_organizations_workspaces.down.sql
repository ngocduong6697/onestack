-- Children before parents: both memberships and workspaces hold a foreign key
-- into organizations.
DROP TABLE IF EXISTS "memberships";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspaces";
--> statement-breakpoint
DROP TABLE IF EXISTS "organizations";
