ALTER TABLE "user_jobs" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_jobs" ADD COLUMN "responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_jobs" ADD COLUMN "follow_up_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_jobs" ADD COLUMN "follow_up_snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_jobs" ADD COLUMN "closed_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_follow_ups" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_digest_at" timestamp with time zone;--> statement-breakpoint
-- Backfill for the overview stats. Exact times weren't kept before, so these are the best guesses:
-- the stage start for jobs still at "applied", otherwise when the job was first tracked.
UPDATE "user_jobs" SET "applied_at" = CASE WHEN "stage" = 'applied' THEN coalesce("stage_changed_at", "created_at") ELSE "created_at" END WHERE "status" = 'applied';--> statement-breakpoint
UPDATE "user_jobs" SET "responded_at" = coalesce("stage_changed_at", "updated_at") WHERE "status" = 'applied' AND "stage" IS NOT NULL AND "stage" <> 'applied';
