import type { neon } from "@neondatabase/serverless"

type NeonQuery = ReturnType<typeof neon>

export type CountRow = {
  table_name: string
  count: string
}

export type PurgeStepResult = {
  label: string
  deleted: number
}

export type PurgeResult = {
  before: CountRow[]
  totalBefore: number
  blocked: CountRow[]
  deletedByStep: PurgeStepResult[]
  totalDeleted: number
  after: CountRow[]
  totalAfter: number
}

async function countTombstones(client: NeonQuery): Promise<CountRow[]> {
  return (await client`
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
}

async function blockedAnomalies(client: NeonQuery): Promise<CountRow[]> {
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
const purgeSteps: ReadonlyArray<{ label: string; run: (client: NeonQuery) => Promise<number> }> = [
  {
    label: "union_events",
    run: (client) => deletedCount(client`
      DELETE FROM union_events
      WHERE deleted_at IS NOT NULL
      RETURNING 1
    `),
  },
  {
    label: "tree_parent_child_relationships",
    run: (client) => deletedCount(client`
      DELETE FROM tree_parent_child_relationships
      WHERE deleted_at IS NOT NULL
      RETURNING 1
    `),
  },
  {
    label: "tree_unions",
    run: (client) => deletedCount(client`
      DELETE FROM tree_unions
      WHERE deleted_at IS NOT NULL
      RETURNING 1
    `),
  },
  {
    label: "tree_members",
    run: (client) => deletedCount(client`
      DELETE FROM tree_members
      WHERE deleted_at IS NOT NULL
      RETURNING 1
    `),
  },
  {
    label: "parent_child_relationships",
    run: (client) => deletedCount(client`
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
    run: (client) => deletedCount(client`
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
    run: (client) => deletedCount(client`
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
    run: (client) => deletedCount(client`
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

async function deletedCount(deleteQuery: Promise<unknown>): Promise<number> {
  const rows = (await deleteQuery) as CountRow[]
  return rows.length
}

export async function purgeTombstones(
  client: NeonQuery,
  options: { apply: boolean },
): Promise<PurgeResult> {
  const before = await countTombstones(client)
  const totalBefore = before.reduce((total, row) => total + Number(row.count), 0)
  const blocked = await blockedAnomalies(client)

  const deletedByStep: PurgeStepResult[] = []
  let totalDeleted = 0
  if (options.apply) {
    for (const step of purgeSteps) {
      const deleted = await step.run(client)
      deletedByStep.push({ label: step.label, deleted })
      totalDeleted += deleted
    }
  }

  const after = await countTombstones(client)
  const totalAfter = after.reduce((total, row) => total + Number(row.count), 0)
  return { before, totalBefore, blocked, deletedByStep, totalDeleted, after, totalAfter }
}
