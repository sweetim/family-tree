import { and, eq, inArray, isNull, or } from "drizzle-orm"
import type { DB } from "../../db"
import { persons, treeShares, trees } from "../../db/schema"
import type { SyncPushRequest, SyncRecordSet } from "../../sync/types"
import { collectMutationChanges, emptyRecordSet } from "./push-changes"
import { personToWire, treeToWire } from "./wire"

export async function collectAuthoritativeConflictRecords(
  db: DB,
  userId: string,
  body: SyncPushRequest,
): Promise<SyncRecordSet> {
  const changes = await collectMutationChanges(db, body, new Map())
  const result = emptyRecordSet()
  const treeIds = [...changes.keys()]
  const readableTreeIds = new Set<string>()
  if (treeIds.length > 0) {
    const rows = await db
      .select({ id: trees.id })
      .from(trees)
      .leftJoin(
        treeShares,
        and(eq(treeShares.treeId, trees.id), eq(treeShares.userId, userId)),
      )
      .where(
        and(
          inArray(trees.id, treeIds),
          isNull(trees.deletedAt),
          or(eq(trees.ownerId, userId), eq(treeShares.userId, userId)),
        ),
      )
    for (const row of rows) readableTreeIds.add(row.id)
  }

  const append = (records: SyncRecordSet) => {
    for (const collection of Object.keys(result) as Array<
      keyof SyncRecordSet
    >) {
      const existing = new Set(
        result[collection].map((wire) => JSON.stringify(wire)),
      )
      for (const wire of records[collection]) {
        const key = JSON.stringify(wire)
        if (!existing.has(key)) {
          result[collection].push(wire as never)
          existing.add(key)
        }
      }
    }
  }

  for (const [treeId, records] of changes) {
    if (readableTreeIds.has(treeId)) append(records)
  }

  const requestedPersonIds = [...new Set(body.persons.map((wire) => wire.id))]
  const requestedTreeIds = [...new Set(body.trees.map((wire) => wire.id))]
  const [ownedPeople, ownedTrees] = await Promise.all([
    requestedPersonIds.length > 0
      ? db
          .select()
          .from(persons)
          .where(
            and(
              inArray(persons.id, requestedPersonIds),
              eq(persons.ownerId, userId),
            ),
          )
      : [],
    requestedTreeIds.length > 0
      ? db
          .select()
          .from(trees)
          .where(
            and(inArray(trees.id, requestedTreeIds), eq(trees.ownerId, userId)),
          )
      : [],
  ])
  append({
    ...emptyRecordSet(),
    persons: ownedPeople.map(personToWire),
    trees: ownedTrees.map((tree) => treeToWire(tree, "owner")),
  })
  return result
}
