ALTER TABLE "persons" ADD COLUMN IF NOT EXISTS "family_name" text;
--> statement-breakpoint
UPDATE "persons" SET "family_name" = '' WHERE "family_name" IS NULL;
--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "family_name" SET DEFAULT '';
--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "family_name" SET NOT NULL;
