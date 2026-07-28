CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TABLE "tree_access_requests" (
	"tree_id" text NOT NULL,
	"user_id" text NOT NULL,
	"comment" text NOT NULL,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tree_access_requests_tree_id_user_id_pk" PRIMARY KEY("tree_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tree_access_requests" ADD CONSTRAINT "tree_access_requests_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_access_requests" ADD CONSTRAINT "tree_access_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tree_access_requests_tree_id_status_idx" ON "tree_access_requests" USING btree ("tree_id","status");