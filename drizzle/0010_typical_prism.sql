ALTER TABLE "persons" ADD COLUMN "photo_updated_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "persons"
SET "photo_updated_at" = "updated_at"
WHERE "photo" IS NOT NULL AND "photo_updated_at" IS NULL;
