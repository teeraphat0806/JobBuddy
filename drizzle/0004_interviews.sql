CREATE TABLE "interviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"place" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminded_evening_at" timestamp with time zone,
	"reminded_soon_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interviews_user_starts_idx" ON "interviews" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "interviews_starts_idx" ON "interviews" USING btree ("starts_at");