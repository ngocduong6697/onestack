CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" "citext",
	"company" text,
	"phone" text,
	"stage" text DEFAULT 'lead' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"converted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notes_customer_idx" ON "customer_notes" USING btree ("customer_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_workspace_email_unique" ON "customers" USING btree ("workspace_id","email") WHERE "customers"."email" is not null;--> statement-breakpoint
CREATE INDEX "customers_workspace_stage_idx" ON "customers" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE INDEX "customers_workspace_id_idx" ON "customers" USING btree ("workspace_id","id");