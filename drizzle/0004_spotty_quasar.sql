CREATE INDEX "parent_child_relationships_active_parent_child_idx" ON "parent_child_relationships" USING btree ("parent_person_id","child_person_id") WHERE "parent_child_relationships"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "parent_child_relationships_active_child_parent_idx" ON "parent_child_relationships" USING btree ("child_person_id","parent_person_id") WHERE "parent_child_relationships"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "persons_lower_name_idx" ON "persons" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "trees_owner_created_id_idx" ON "trees" USING btree ("owner_id","created_at","id");