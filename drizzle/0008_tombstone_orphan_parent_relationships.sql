WITH server_clock AS (
  SELECT CURRENT_TIMESTAMP AS value
)
UPDATE "parent_child_relationships" AS relationship
SET
  "deleted_at" = (SELECT value FROM server_clock),
  "updated_at" = (SELECT value FROM server_clock),
  "revision" = relationship."revision" + 1
WHERE relationship."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "tree_parent_child_relationships" AS association
    WHERE association."parent_child_relationship_id" = relationship."id"
      AND association."deleted_at" IS NULL
  );
