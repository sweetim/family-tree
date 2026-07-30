import { neon } from "@neondatabase/serverless"

type CountRow = {
  table_name: string
  count: string
}

async function purgeTombstones(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string to the environment before running db:purge-tombstones.",
    )
  }

  const shouldApply = process.argv.includes("--apply")
  const client = neon(databaseUrl)

  const tombstoneCounts = async (): Promise<CountRow[]> =>
    (await client`
      SELECT * FROM (
        SELECT 'union_events' AS table_name, count(*) FROM union_events WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'tree_parent_child_relationships', count(*) FROM tree_parent_child_relationships WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'tree_unions', count(*) FROM tree_unions WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'tree_members', count(*) FROM tree_members WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'parent_child_relationships', count(*) FROM parent_child_relationships WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'unions', count(*) FROM unions WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'persons', count(*) FROM persons WHERE deleted_at IS NOT NULL
        UNION ALL SELECT 'trees', count(*) FROM trees WHERE deleted_at IS NOT NULL
      ) AS counts
    `) as CountRow[]

  const blockedAnomalies = async (): Promise<CountRow[]> => {
    const rows = (await client`
      SELECT * FROM (
        SELECT 'parent_child_relationships' AS table_name, count(*)
        FROM parent_child_relationships
        WHERE deleted_at IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM tree_parent_child_relationships
            WHERE parent_child_relationship_id = parent_child_relationships.id
              AND deleted_at IS NULL
          )
        UNION ALL
        SELECT 'persons', count(*)
        FROM persons
        WHERE deleted_at IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM unions WHERE deleted_at IS NULL AND (first_person_id = persons.id OR second_person_id = persons.id))
            OR EXISTS (SELECT 1 FROM parent_child_relationships WHERE deleted_at IS NULL AND (parent_person_id = persons.id OR child_person_id = persons.id))
            OR EXISTS (SELECT 1 FROM tree_members WHERE person_id = persons.id AND deleted_at IS NULL)
          )
        UNION ALL
        SELECT 'trees', count(*)
        FROM trees
        WHERE deleted_at IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM tree_members WHERE tree_id = trees.id AND deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM tree_unions WHERE tree_id = trees.id AND deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM tree_parent_child_relationships WHERE tree_id = trees.id AND deleted_at IS NULL)
          )
      ) AS blocked
    `) as CountRow[]
    return rows.filter((row) => Number(row.count) > 0)
  }

  // Child-first ordering keeps the schema's ON DELETE CASCADE foreign keys
  // predictable: dependents are removed before the parents they reference.
  // Parent tables guard with NOT EXISTS so a tombstoned parent that still has
  // ACTIVE dependents is left in place (cascade would otherwise take live data).
  const purgeSteps: ReadonlyArray<{ label: string; run: () => Promise<number> }> = [
    {
      label: "union_events",
      run: async () => deletedCount(client`
        DELETE FROM union_events
        WHERE deleted_at IS NOT NULL
        RETURNING 1
      `),
    },
    {
      label: "tree_parent_child_relationships",
      run: async () => deletedCount(client`
        DELETE FROM tree_parent_child_relationships
        WHERE deleted_at IS NOT NULL
        RETURNING 1
      `),
    },
    {
      label: "tree_unions",
      run: async () => deletedCount(client`
        DELETE FROM tree_unions
        WHERE deleted_at IS NOT NULL
        RETURNING 1
      `),
    },
    {
      label: "tree_members",
      run: async () => deletedCount(client`
        DELETE FROM tree_members
        WHERE deleted_at IS NOT NULL
        RETURNING 1
      `),
    },
    {
      label: "parent_child_relationships",
      run: async () => deletedCount(client`
        DELETE FROM parent_child_relationships
        WHERE deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM tree_parent_child_relationships
            WHERE parent_child_relationship_id = parent_child_relationships.id
              AND deleted_at IS NULL
          )
        RETURNING 1
      `),
    },
    {
      label: "unions",
      run: async () => deletedCount(client`
        DELETE FROM unions
        WHERE deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM tree_unions
            WHERE union_id = unions.id AND deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM union_events
            WHERE union_id = unions.id AND deleted_at IS NULL
          )
        RETURNING 1
      `),
    },
    {
      label: "persons",
      run: async () => deletedCount(client`
        DELETE FROM persons
        WHERE deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM unions
            WHERE deleted_at IS NULL
              AND (first_person_id = persons.id OR second_person_id = persons.id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM parent_child_relationships
            WHERE deleted_at IS NULL
              AND (parent_person_id = persons.id OR child_person_id = persons.id)
          )
          AND NOT EXISTS (
            SELECT 1 FROM tree_members
            WHERE person_id = persons.id AND deleted_at IS NULL
          )
        RETURNING 1
      `),
    },
    {
      label: "trees",
      run: async () => deletedCount(client`
        DELETE FROM trees
        WHERE deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM tree_members
            WHERE tree_id = trees.id AND deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM tree_unions
            WHERE tree_id = trees.id AND deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM tree_parent_child_relationships
            WHERE tree_id = trees.id AND deleted_at IS NULL
          )
        RETURNING 1
      `),
    },
  ]

  const before = await tombstoneCounts()
  const totalBefore = before.reduce((total, row) => total + Number(row.count), 0)
  printCounts("Tombstoned rows by table:", before)
  console.log(`Total tombstoned rows: ${totalBefore}`)

  const blocked = await blockedAnomalies()
  if (blocked.length > 0) {
    console.warn(
      "Some tombstoned parents still have ACTIVE dependents and will be skipped (cascade would delete live data). Run `bun run db:validate` to repair:",
    )
    for (const row of blocked) {
      console.warn(`  ${row.table_name}: ${row.count}`)
    }
  }

  if (!shouldApply) {
    console.log(
      "\nDry run only. Re-run with --apply to delete the tombstoned rows listed above.",
    )
    return
  }

  console.log("\nApplying purge...")
  let totalDeleted = 0
  for (const step of purgeSteps) {
    const deleted = await step.run()
    totalDeleted += deleted
    console.log(`  ${step.label}: removed ${deleted}`)
  }

  const after = await tombstoneCounts()
  const totalAfter = after.reduce((total, row) => total + Number(row.count), 0)
  printCounts("\nRemaining tombstoned rows by table:", after)
  console.log(`Total removed: ${totalDeleted}`)
  console.log(`Total tombstoned rows remaining: ${totalAfter}`)
}

async function deletedCount(deleteQuery: Promise<unknown>): Promise<number> {
  const rows = (await deleteQuery) as CountRow[]
  return rows.length
}

function printCounts(title: string, rows: readonly CountRow[]): void {
  if (rows.length === 0) return
  const longest = Math.max(...rows.map((row) => row.table_name.length))
  console.log(title)
  for (const row of rows) {
    console.log(`  ${row.table_name.padEnd(longest)}  tombstoned=${row.count}`)
  }
}

try {
  await purgeTombstones()
} catch (error) {
  console.error("Tombstone purge could not complete.")
  console.error(error instanceof Error ? error.message : String(error))
  console.error(
    "Confirm DATABASE_URL points to the intended reachable Neon database and retry db:purge-tombstones.",
  )
  process.exitCode = 1
}
