CREATE TYPE "public"."user_status" AS ENUM('active', 'unfollowed');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_user_id" text NOT NULL,
	"display_name" text,
	"picture_url" text,
	"language" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"notify_interview_reminders" boolean DEFAULT true NOT NULL,
	"pdpa_consented_at" timestamp with time zone,
	"followed_at" timestamp with time zone,
	"unfollowed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_line_user_id_unique" UNIQUE("line_user_id")
);
