CREATE TABLE "ideation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand" text NOT NULL,
	"direction" text NOT NULL,
	"content_types" jsonb NOT NULL,
	"number_of_ideas" integer DEFAULT 25 NOT NULL,
	"additional_context" text,
	"status" text DEFAULT 'new' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"hook" text NOT NULL,
	"content_type" text NOT NULL,
	"suggested_angle" text NOT NULL,
	"visual_direction" text NOT NULL,
	"platform_recommendation" text NOT NULL,
	"core_value_props" text,
	"copy_direction" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_request_id_ideation_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ideation_requests"("id") ON DELETE cascade ON UPDATE no action;
