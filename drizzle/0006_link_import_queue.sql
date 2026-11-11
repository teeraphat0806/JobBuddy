CREATE TYPE "public"."link_import_outcome" AS ENUM('new', 'duplicate', 'invalid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."link_import_status" AS ENUM('pending', 'working', 'done');--> statement-breakpoint
CREATE TABLE "link_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"total" integer NOT NULL,
	"repeated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "link_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" "link_import_status" DEFAULT 'pending' NOT NULL,
	"outcome" "link_import_outcome",
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "link_import_batches" ADD CONSTRAINT "link_import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_imports" ADD CONSTRAINT "link_imports_batch_id_link_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."link_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_imports" ADD CONSTRAINT "link_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_imports" ADD CONSTRAINT "link_imports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_import_batches_user_idx" ON "link_import_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "link_imports_status_idx" ON "link_imports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "link_imports_batch_idx" ON "link_imports" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "link_imports_user_status_idx" ON "link_imports" USING btree ("user_id","status");