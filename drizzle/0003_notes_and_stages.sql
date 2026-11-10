CREATE TYPE "public"."application_stage" AS ENUM('applied', 'contacted', 'interview', 'waiting', 'offer', 'rejected');--> statement-breakpoint
CREATE TABLE "job_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_jobs" ADD COLUMN "stage" "application_stage";--> statement-breakpoint
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_notes" ADD CONSTRAINT "job_notes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_notes_user_job_idx" ON "job_notes" USING btree ("user_id","job_id");--> statement-breakpoint
UPDATE "user_jobs" SET "stage" = 'applied' WHERE "status" = 'applied';