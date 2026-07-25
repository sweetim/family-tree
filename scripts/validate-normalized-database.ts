import { neon } from "@neondatabase/serverless"

type SchemaColumnRow = {
  tableName: string
  columnName: string
}

type DataIssueRow = {
  code: string
  issueCount: string
  sampleDetails: string
}

type RecordCountRow = {
  tableName: string
  activeCount: string
  tombstonedCount: string
}

type ValidationIssue = {
  code: string
  summary: string
  action: string
}

const EXPECTED_COLUMNS_BY_TABLE = {
  persons: [
    "id",
    "owner_id",
    "name",
    "dob",
    "dod",
    "gender",
    "location",
    "photo",
    "updated_at",
    "deleted_at",
  ],
  trees: ["id", "owner_id", "name", "created_at", "updated_at", "deleted_at"],
  tree_members: [
    "tree_id",
    "person_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  unions: [
    "id",
    "first_person_id",
    "second_person_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  union_events: [
    "id",
    "union_id",
    "type",
    "event_date",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  tree_unions: [
    "tree_id",
    "union_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  parent_child_relationships: [
    "id",
    "parent_person_id",
    "child_person_id",
    "type",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  tree_parent_child_relationships: [
    "tree_id",
    "parent_child_relationship_id",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
} as const satisfies Record<string, readonly string[]>

const DATA_ISSUE_ACTIONS: Record<string, string> = {
  active_tree_membership_invalid_tree:
    "Restore the tree or tombstone the active tree membership.",
  active_tree_membership_invalid_person:
    "Restore the person or tombstone the active tree membership.",
  active_tree_union_invalid_tree:
    "Restore the tree or tombstone the active tree-union association.",
  active_tree_union_invalid_fact:
    "Restore the union fact or tombstone the active tree-union association.",
  active_tree_union_nonmember_endpoint:
    "Restore the endpoint's active tree membership or tombstone the tree-union association.",
  active_tree_parent_invalid_tree:
    "Restore the tree or tombstone the active tree-parent association.",
  active_tree_parent_invalid_fact:
    "Restore the parent fact or tombstone the active tree-parent association.",
  active_tree_parent_nonmember_endpoint:
    "Restore the endpoint's active tree membership or tombstone the tree-parent association.",
  active_union_event_invalid_union:
    "Restore the union or tombstone the active union event.",
  self_union:
    "Remove or correct the union with identical endpoints in a reviewed repair migration.",
  noncanonical_union:
    "Rewrite the union endpoints in C-collation order in a reviewed repair migration.",
  self_parent:
    "Remove or correct the self-parent relationship in a reviewed repair migration.",
  duplicate_active_parent_pair:
    "Keep one active parent pair and tombstone duplicates, then verify the active unique index.",
  too_many_active_global_parents:
    "Review the child's global parent facts and leave at most two active parents.",
  active_global_ancestry_cycle:
    "Review the reported ancestry path and tombstone or correct the relationship that creates the cycle.",
  invalid_person_gender:
    "Set gender to null, male, female, or other in a reviewed repair migration.",
}

function collectSchemaIssues(rows: readonly SchemaColumnRow[]) {
  const columnsByTable = new Map<string, Set<string>>()

  for (const row of rows) {
    const columns = columnsByTable.get(row.tableName) ?? new Set<string>()
    columns.add(row.columnName)
    columnsByTable.set(row.tableName, columns)
  }

  const issues: ValidationIssue[] = []

  for (const [tableName, expectedColumns] of Object.entries(
    EXPECTED_COLUMNS_BY_TABLE,
  )) {
    const actualColumns = columnsByTable.get(tableName)

    if (!actualColumns) {
      issues.push({
        code: "missing_normalized_table",
        summary: `public.${tableName} is missing.`,
        action:
          "Back up the database, rehearse the migration against a restore, then run bun run db:migrate.",
      })
      continue
    }

    const missingColumns = expectedColumns.filter(
      (columnName) => !actualColumns.has(columnName),
    )
    if (missingColumns.length > 0) {
      issues.push({
        code: "missing_normalized_columns",
        summary: `public.${tableName} is missing columns: ${missingColumns.join(", ")}.`,
        action:
          "Compare the deployed migration state with the committed Drizzle migrations before retrying validation.",
      })
    }
  }

  if (columnsByTable.get("trees")?.has("edges")) {
    issues.push({
      code: "legacy_trees_edges_present",
      summary:
        "public.trees.edges still exists, so normalization is incomplete.",
      action:
        "Back up the database, rehearse the normalization migration against a restore, then run bun run db:migrate.",
    })
  }

  return issues
}

function printIssues(issues: readonly ValidationIssue[]) {
  console.error(
    `Normalized database validation failed with ${issues.length} issue categor${issues.length === 1 ? "y" : "ies"}.`,
  )

  for (const issue of issues) {
    console.error(`- [${issue.code}] ${issue.summary}`)
    console.error(`  Action: ${issue.action}`)
  }
}

function printRecordCounts(rows: readonly RecordCountRow[]) {
  const longestTableName = Math.max(
    ...rows.map((row) => row.tableName.length),
    "table".length,
  )

  console.log("Active and tombstoned record counts:")
  for (const row of rows) {
    console.log(
      `  ${row.tableName.padEnd(longestTableName)}  active=${row.activeCount}  tombstoned=${row.tombstonedCount}`,
    )
  }
}

async function validateNormalizedDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string to the environment before running db:validate.",
    )
  }

  const databaseClient = neon(databaseUrl)
  const schemaColumnRows = (await databaseClient`
    SELECT
      table_name AS "tableName",
      column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `) as SchemaColumnRow[]

  const schemaIssues = collectSchemaIssues(schemaColumnRows)
  if (schemaIssues.length > 0) {
    printIssues(schemaIssues)
    process.exitCode = 1
    return
  }

  const dataIssueRows = (await databaseClient`
    WITH RECURSIVE active_parent_edges AS (
      SELECT DISTINCT parent_person_id, child_person_id
      FROM parent_child_relationships
      WHERE deleted_at IS NULL
    ), ancestry(descendant_person_id, ancestor_person_id) AS (
      SELECT child_person_id, parent_person_id
      FROM active_parent_edges
      UNION
      SELECT ancestry.descendant_person_id, active_parent_edges.parent_person_id
      FROM ancestry
      INNER JOIN active_parent_edges
        ON active_parent_edges.child_person_id = ancestry.ancestor_person_id
    ), raw_issues(code, details) AS (
      SELECT
        'active_tree_membership_invalid_tree',
        format(
          'tree=%s person=%s tree_status=%s',
          membership.tree_id,
          membership.person_id,
          CASE WHEN tree_record.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM tree_members AS membership
      LEFT JOIN trees AS tree_record ON tree_record.id = membership.tree_id
      WHERE membership.deleted_at IS NULL
        AND (tree_record.id IS NULL OR tree_record.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'active_tree_membership_invalid_person',
        format(
          'tree=%s person=%s person_status=%s',
          membership.tree_id,
          membership.person_id,
          CASE WHEN person.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM tree_members AS membership
      LEFT JOIN persons AS person ON person.id = membership.person_id
      WHERE membership.deleted_at IS NULL
        AND (person.id IS NULL OR person.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'active_tree_union_invalid_tree',
        format(
          'tree=%s union=%s tree_status=%s',
          association.tree_id,
          association.union_id,
          CASE WHEN tree_record.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM tree_unions AS association
      LEFT JOIN trees AS tree_record ON tree_record.id = association.tree_id
      WHERE association.deleted_at IS NULL
        AND (tree_record.id IS NULL OR tree_record.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'active_tree_union_invalid_fact',
        format(
          'tree=%s union=%s union_status=%s',
          association.tree_id,
          association.union_id,
          CASE WHEN union_record.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM tree_unions AS association
      LEFT JOIN unions AS union_record ON union_record.id = association.union_id
      WHERE association.deleted_at IS NULL
        AND (union_record.id IS NULL OR union_record.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'active_tree_union_nonmember_endpoint',
        format(
          'tree=%s union=%s person=%s',
          association.tree_id,
          association.union_id,
          endpoint.person_id
        )
      FROM tree_unions AS association
      INNER JOIN unions AS union_record
        ON union_record.id = association.union_id
        AND union_record.deleted_at IS NULL
      CROSS JOIN LATERAL (
        VALUES (union_record.first_person_id), (union_record.second_person_id)
      ) AS endpoint(person_id)
      LEFT JOIN tree_members AS membership
        ON membership.tree_id = association.tree_id
        AND membership.person_id = endpoint.person_id
        AND membership.deleted_at IS NULL
      WHERE association.deleted_at IS NULL
        AND membership.person_id IS NULL

      UNION ALL

      SELECT
        'active_tree_parent_invalid_tree',
        format(
          'tree=%s relationship=%s tree_status=%s',
          association.tree_id,
          association.parent_child_relationship_id,
          CASE WHEN tree_record.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM tree_parent_child_relationships AS association
      LEFT JOIN trees AS tree_record ON tree_record.id = association.tree_id
      WHERE association.deleted_at IS NULL
        AND (tree_record.id IS NULL OR tree_record.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'active_tree_parent_invalid_fact',
        format(
          'tree=%s relationship=%s relationship_status=%s',
          association.tree_id,
          association.parent_child_relationship_id,
          CASE WHEN relationship.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM tree_parent_child_relationships AS association
      LEFT JOIN parent_child_relationships AS relationship
        ON relationship.id = association.parent_child_relationship_id
      WHERE association.deleted_at IS NULL
        AND (relationship.id IS NULL OR relationship.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'active_tree_parent_nonmember_endpoint',
        format(
          'tree=%s relationship=%s person=%s',
          association.tree_id,
          association.parent_child_relationship_id,
          endpoint.person_id
        )
      FROM tree_parent_child_relationships AS association
      INNER JOIN parent_child_relationships AS relationship
        ON relationship.id = association.parent_child_relationship_id
        AND relationship.deleted_at IS NULL
      CROSS JOIN LATERAL (
        VALUES (relationship.parent_person_id), (relationship.child_person_id)
      ) AS endpoint(person_id)
      LEFT JOIN tree_members AS membership
        ON membership.tree_id = association.tree_id
        AND membership.person_id = endpoint.person_id
        AND membership.deleted_at IS NULL
      WHERE association.deleted_at IS NULL
        AND membership.person_id IS NULL

      UNION ALL

      SELECT
        'active_union_event_invalid_union',
        format(
          'event=%s union=%s union_status=%s',
          event.id,
          event.union_id,
          CASE WHEN union_record.id IS NULL THEN 'missing' ELSE 'tombstoned' END
        )
      FROM union_events AS event
      LEFT JOIN unions AS union_record ON union_record.id = event.union_id
      WHERE event.deleted_at IS NULL
        AND (union_record.id IS NULL OR union_record.deleted_at IS NOT NULL)

      UNION ALL

      SELECT
        'self_union',
        format('union=%s person=%s', id, first_person_id)
      FROM unions
      WHERE first_person_id = second_person_id

      UNION ALL

      SELECT
        'noncanonical_union',
        format(
          'union=%s first_person=%s second_person=%s',
          id,
          first_person_id,
          second_person_id
        )
      FROM unions
      WHERE first_person_id COLLATE "C" > second_person_id COLLATE "C"

      UNION ALL

      SELECT
        'self_parent',
        format('relationship=%s person=%s', id, parent_person_id)
      FROM parent_child_relationships
      WHERE parent_person_id = child_person_id

      UNION ALL

      SELECT
        'duplicate_active_parent_pair',
        format(
          'parent=%s child=%s active_count=%s',
          parent_person_id,
          child_person_id,
          count(*)
        )
      FROM parent_child_relationships
      WHERE deleted_at IS NULL
      GROUP BY parent_person_id, child_person_id
      HAVING count(*) > 1

      UNION ALL

      SELECT
        'too_many_active_global_parents',
        format(
          'child=%s active_parent_count=%s',
          child_person_id,
          count(DISTINCT parent_person_id)
        )
      FROM parent_child_relationships
      WHERE deleted_at IS NULL
      GROUP BY child_person_id
      HAVING count(DISTINCT parent_person_id) > 2

      UNION ALL

      SELECT DISTINCT
        'active_global_ancestry_cycle',
        format('person=%s', descendant_person_id)
      FROM ancestry
      WHERE descendant_person_id = ancestor_person_id

      UNION ALL

      SELECT
        'invalid_person_gender',
        format('person=%s gender=%s', id, gender)
      FROM persons
      WHERE gender IS NOT NULL
        AND gender NOT IN ('male', 'female', 'other')
    ), issue_counts AS (
      SELECT code, count(*) AS issue_count
      FROM raw_issues
      GROUP BY code
    )
    SELECT
      issue_counts.code,
      issue_counts.issue_count::text AS "issueCount",
      samples.sample_details AS "sampleDetails"
    FROM issue_counts
    CROSS JOIN LATERAL (
      SELECT string_agg(sample.details, '; ' ORDER BY sample.details) AS sample_details
      FROM (
        SELECT DISTINCT candidate.details
        FROM raw_issues AS candidate
        WHERE candidate.code = issue_counts.code
        ORDER BY candidate.details
        LIMIT 5
      ) AS sample
    ) AS samples
    ORDER BY issue_counts.code
  `) as DataIssueRow[]

  if (dataIssueRows.length > 0) {
    const dataIssues = dataIssueRows.map((row) => ({
      code: row.code,
      summary: `${row.issueCount} violation(s). Samples: ${row.sampleDetails}`,
      action:
        DATA_ISSUE_ACTIONS[row.code]
        ?? "Inspect the sampled records and correct them in a reviewed repair migration.",
    }))
    printIssues(dataIssues)
    process.exitCode = 1
    return
  }

  const recordCountRows = (await databaseClient`
    SELECT
      record_counts.table_name AS "tableName",
      record_counts.active_count::text AS "activeCount",
      record_counts.tombstoned_count::text AS "tombstonedCount"
    FROM (
      SELECT
        1 AS display_order,
        'persons' AS table_name,
        count(*) FILTER (WHERE deleted_at IS NULL) AS active_count,
        count(*) FILTER (WHERE deleted_at IS NOT NULL) AS tombstoned_count
      FROM persons

      UNION ALL

      SELECT
        2,
        'trees',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM trees

      UNION ALL

      SELECT
        3,
        'tree_members',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM tree_members

      UNION ALL

      SELECT
        4,
        'unions',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM unions

      UNION ALL

      SELECT
        5,
        'union_events',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM union_events

      UNION ALL

      SELECT
        6,
        'tree_unions',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM tree_unions

      UNION ALL

      SELECT
        7,
        'parent_child_relationships',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM parent_child_relationships

      UNION ALL

      SELECT
        8,
        'tree_parent_child_relationships',
        count(*) FILTER (WHERE deleted_at IS NULL),
        count(*) FILTER (WHERE deleted_at IS NOT NULL)
      FROM tree_parent_child_relationships
    ) AS record_counts
    ORDER BY record_counts.display_order
  `) as RecordCountRow[]

  console.log("Normalized database validation passed.")
  printRecordCounts(recordCountRows)
}

try {
  await validateNormalizedDatabase()
} catch (error) {
  console.error("Normalized database validation could not complete.")
  console.error(error instanceof Error ? error.message : String(error))
  console.error(
    "Confirm DATABASE_URL points to the intended reachable Neon database and retry db:validate.",
  )
  process.exitCode = 1
}
