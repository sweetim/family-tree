DO $$
BEGIN
	CREATE TYPE "public"."share_role" AS ENUM('viewer', 'editor');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END
$$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persons" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"dob" text,
	"dod" text,
	"gender" text,
	"location" text,
	"photo" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tree_shares" (
	"tree_id" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"role" "share_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tree_shares_tree_id_email_pk" PRIMARY KEY("tree_id", "email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trees" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"edges" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique" ON "session" ("token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email");
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'account_user_id_user_id_fk'
			AND conrelid = 'public.account'::regclass
	) THEN
		ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'persons_owner_id_user_id_fk'
			AND conrelid = 'public.persons'::regclass
	) THEN
		ALTER TABLE "persons" ADD CONSTRAINT "persons_owner_id_user_id_fk"
			FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'session_user_id_user_id_fk'
			AND conrelid = 'public.session'::regclass
	) THEN
		ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'tree_shares_tree_id_trees_id_fk'
			AND conrelid = 'public.tree_shares'::regclass
	) THEN
		ALTER TABLE "tree_shares" ADD CONSTRAINT "tree_shares_tree_id_trees_id_fk"
			FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'tree_shares_user_id_user_id_fk'
			AND conrelid = 'public.tree_shares'::regclass
	) THEN
		ALTER TABLE "tree_shares" ADD CONSTRAINT "tree_shares_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
			ON DELETE set null ON UPDATE no action;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'trees_owner_id_user_id_fk'
			AND conrelid = 'public.trees'::regclass
	) THEN
		ALTER TABLE "trees" ADD CONSTRAINT "trees_owner_id_user_id_fk"
			FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'trees'
			AND column_name = 'edges'
			AND data_type = 'jsonb'
			AND is_nullable = 'NO'
	) THEN
		RAISE EXCEPTION 'Baseline requires public.trees.edges to be a non-null jsonb column';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name IN ('persons', 'trees')
			AND column_name = 'id'
			AND data_type <> 'text'
	) THEN
		RAISE EXCEPTION 'Baseline requires persons.id and trees.id to remain text';
	END IF;
END
$$;
