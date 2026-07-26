CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "persons_lower_name_idx";--> statement-breakpoint
CREATE INDEX "persons_name_trgm_idx" ON "persons" USING gin (lower("name") gin_trgm_ops);
