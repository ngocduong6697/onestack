CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"captured_on" date NOT NULL,
	"mrr_micro_usd" bigint DEFAULT 0 NOT NULL,
	"customers" integer DEFAULT 0 NOT NULL,
	"active_customers" integer DEFAULT 0 NOT NULL,
	"active_subscriptions" integer DEFAULT 0 NOT NULL,
	"ai_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"recorded_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"recorded_revenue_micro_usd" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_range_idx" ON "ledger_entries" USING btree ("workspace_id","entry_date");--> statement-breakpoint
CREATE INDEX "ledger_entries_workspace_id_idx" ON "ledger_entries" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshots_day_unique" ON "metric_snapshots" USING btree ("workspace_id","captured_on");--> statement-breakpoint
CREATE INDEX "metric_snapshots_range_idx" ON "metric_snapshots" USING btree ("workspace_id","captured_on");