CREATE INDEX "persons_owner_id_updated_at_idx" ON "persons" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "tree_shares_user_id_tree_id_idx" ON "tree_shares" USING btree ("user_id","tree_id") WHERE "tree_shares"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tree_shares_pending_email_idx" ON "tree_shares" USING btree ("email") WHERE "tree_shares"."user_id" IS NULL;--> statement-breakpoint
CREATE INDEX "trees_owner_id_idx" ON "trees" USING btree ("owner_id");