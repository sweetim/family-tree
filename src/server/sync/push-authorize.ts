import { and, eq, inArray, isNull } from "drizzle-orm"
import type { DB } from "../../db"
import {
  type parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
  treeUnions,
  type unions,
} from "../../db/schema"
import { canWrite, type Role } from "../acl"

export type RoleForTree = (treeId: string) => Promise<Role | null>
export type ActivePeopleExist = (personIds: string[]) => Promise<boolean>

async function ownedEndpointCount(
  db: DB,
  userId: string,
  personIds: string[],
): Promise<number> {
  const uniqueIds = [...new Set(personIds)]
  if (uniqueIds.length === 0) return 0
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(inArray(persons.id, uniqueIds), eq(persons.ownerId, userId)))
  return rows.length
}

async function hasWritableTreeContaining(
  db: DB,
  personIds: string[],
  roleForTree: RoleForTree,
): Promise<boolean> {
  const uniqueIds = [...new Set(personIds)]
  if (uniqueIds.length !== personIds.length || uniqueIds.length === 0) {
    return false
  }
  const rows = await db
    .select({ treeId: treeMembers.treeId, personId: treeMembers.personId })
    .from(treeMembers)
    .where(
      and(
        inArray(treeMembers.personId, uniqueIds),
        isNull(treeMembers.deletedAt),
      ),
    )
  const peopleByTree = new Map<string, Set<string>>()
  for (const row of rows) {
    const people = peopleByTree.get(row.treeId) ?? new Set<string>()
    people.add(row.personId)
    peopleByTree.set(row.treeId, people)
  }
  for (const [treeId, people] of peopleByTree) {
    if (
      people.size === uniqueIds.length
      && canWrite(await roleForTree(treeId))
    ) {
      return true
    }
  }
  return false
}

async function rolesForTrees(
  treeIds: string[],
  roleForTree: RoleForTree,
): Promise<Array<Role | null>> {
  return Promise.all([...new Set(treeIds)].map(roleForTree))
}

async function rolesForUnion(
  db: DB,
  unionId: string,
  roleForTree: RoleForTree,
): Promise<Array<Role | null>> {
  const rows = await db
    .select({ treeId: treeUnions.treeId })
    .from(treeUnions)
    .where(and(eq(treeUnions.unionId, unionId), isNull(treeUnions.deletedAt)))
  return rolesForTrees(
    rows.map((row) => row.treeId),
    roleForTree,
  )
}

async function rolesForParentRelationship(
  db: DB,
  relationshipId: string,
  roleForTree: RoleForTree,
): Promise<Array<Role | null>> {
  const rows = await db
    .select({ treeId: treeParentChildRelationships.treeId })
    .from(treeParentChildRelationships)
    .where(
      and(
        eq(
          treeParentChildRelationships.parentChildRelationshipId,
          relationshipId,
        ),
        isNull(treeParentChildRelationships.deletedAt),
      ),
    )
  return rolesForTrees(
    rows.map((row) => row.treeId),
    roleForTree,
  )
}

async function canWriteExistingUnion(
  db: DB,
  userId: string,
  row: typeof unions.$inferSelect,
  roleForTree: RoleForTree,
): Promise<boolean> {
  const roles = await rolesForUnion(db, row.id, roleForTree)
  if (roles.some(canWrite)) return true
  return (
    (await ownedEndpointCount(db, userId, [
      row.firstPersonId,
      row.secondPersonId,
    ])) === 2
  )
}

async function canWriteExistingParentRelationship(
  db: DB,
  userId: string,
  row: typeof parentChildRelationships.$inferSelect,
  roleForTree: RoleForTree,
): Promise<boolean> {
  const roles = await rolesForParentRelationship(db, row.id, roleForTree)
  if (roles.some(canWrite)) return true
  return (
    (await ownedEndpointCount(db, userId, [
      row.parentPersonId,
      row.childPersonId,
    ])) === 2
  )
}

async function activeTreeHasMembers(
  db: DB,
  treeId: string,
  personIds: string[],
  activePeopleExist: ActivePeopleExist,
): Promise<boolean> {
  const uniqueIds = [...new Set(personIds)]
  const rows = await db
    .select({ personId: treeMembers.personId })
    .from(treeMembers)
    .where(
      and(
        eq(treeMembers.treeId, treeId),
        inArray(treeMembers.personId, uniqueIds),
        isNull(treeMembers.deletedAt),
      ),
    )
  return (
    rows.length === uniqueIds.length && (await activePeopleExist(uniqueIds))
  )
}

export {
  activeTreeHasMembers,
  canWriteExistingParentRelationship,
  canWriteExistingUnion,
  hasWritableTreeContaining,
}
