import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { and, eq, inArray } from "drizzle-orm"
import { getDB, schema } from "../../db"
import type {
  SyncAppliedIds,
  SyncMutationResponse,
  SyncPushRequest,
} from "../../sync/types"
import type { SessionUser } from "../session"

/**
 * The Vercel Blob SDK is mocked so the photo lifecycle (upload → stored URL,
 * replace → old deleted after commit, malformed → skipped) is deterministic
 * and never hits the network. This is also what isolates this file from
 * blob.test.ts's no-op `mock.module("@vercel/blob", ...)`, which would
 * otherwise leak into the shared test process and make `put` return undefined.
 */
const putPhotoMock = mock((_pathname: string) => ({
  url: `https://test.public.blob.vercel-storage.com/photos/test/${crypto.randomUUID()}.jpg`,
}))
const deletePhotoMock = mock(async (_urls: string[]) => undefined)
mock.module("@vercel/blob", () => ({
  del: deletePhotoMock,
  get: mock(),
  put: putPhotoMock,
}))

const { runSyncMutation } = await import("./push")
const { runDirectTreeDeletion } = await import("../handlers/trees")

/**
 * Integration characterization tests for the normalized sync mutation
 * pipeline (`runSyncMutation`). They run against the real Neon database and
 * (for photos) the real Vercel Blob store, locking the exact behavior that the
 * batched-read (#3) and out-of-transaction-photo (#4) refactors must preserve.
 *
 * All test data is namespaced by a unique run id and torn down afterwards;
 * person deletes cascade to every association table, so deleting the two test
 * users cleans up everything except the Blob uploads, which are deleted
 * explicitly.
 */

const db = getDB()
const RUN = `push-it-${crypto.randomUUID()}`

const owner: SessionUser = { id: `${RUN}-owner`, email: `${RUN}-owner@test` }
const other: SessionUser = { id: `${RUN}-other`, email: `${RUN}-other@test` }

function now(): string {
  return new Date().toISOString()
}

function emptyBody(): SyncPushRequest {
  return {
    persons: [],
    trees: [],
    treeMembers: [],
    unions: [],
    unionEvents: [],
    treeUnions: [],
    parentChildRelationships: [],
    treeParentChildRelationships: [],
  }
}

async function mutate(
  me: SessionUser,
  body: SyncPushRequest,
  mutationId: string | null = null,
): Promise<SyncMutationResponse> {
  const response = await runSyncMutation(me, body, mutationId)
  expect(response.status).toBe(200)
  return (await response.json()) as SyncMutationResponse
}

function appliedOf(result: SyncMutationResponse): SyncAppliedIds {
  return result.applied
}

async function createDeletionFixture(suffix: string): Promise<{
  treeId: string
  parentId: string
  childId: string
  unionId: string
  parentRelationshipId: string
}> {
  const treeId = `${RUN}-delete-${suffix}-tree`
  const parentId = `${RUN}-delete-${suffix}-parent`
  const childId = `${RUN}-delete-${suffix}-child`
  const unionId = `${RUN}-delete-${suffix}-union`
  const parentRelationshipId = `${RUN}-delete-${suffix}-relationship`
  const [firstPersonId, secondPersonId]: [string, string] =
    parentId < childId ? [parentId, childId] : [childId, parentId]

  await mutate(owner, {
    ...emptyBody(),
    trees: [
      {
        id: treeId,
        name: "Deletion fixture",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    persons: [
      { id: parentId, name: "Parent", updatedAt: now() },
      { id: childId, name: "Child", updatedAt: now() },
    ],
    treeMembers: [
      { treeId, personId: parentId, createdAt: now(), updatedAt: now() },
      { treeId, personId: childId, createdAt: now(), updatedAt: now() },
    ],
    unions: [
      {
        id: unionId,
        firstPersonId,
        secondPersonId,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    unionEvents: [
      {
        id: `${unionId}-event`,
        unionId,
        type: "married",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeUnions: [{ treeId, unionId, createdAt: now(), updatedAt: now() }],
    parentChildRelationships: [
      {
        id: parentRelationshipId,
        parentPersonId: parentId,
        childPersonId: childId,
        type: "biological",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeParentChildRelationships: [
      {
        treeId,
        parentChildRelationshipId: parentRelationshipId,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  })
  await db.insert(schema.treeShares).values({
    treeId,
    email: `${RUN}-delete-${suffix}@test`,
    role: "viewer",
  })
  return { treeId, parentId, childId, unionId, parentRelationshipId }
}

async function expectTreeDeletionCascade(
  fixture: Awaited<ReturnType<typeof createDeletionFixture>>,
): Promise<void> {
  const [tree, parent, child, member, treeUnion, parentAssociation, share] =
    await Promise.all([
      db.query.trees.findFirst({ where: eq(schema.trees.id, fixture.treeId) }),
      db.query.persons.findFirst({
        where: eq(schema.persons.id, fixture.parentId),
      }),
      db.query.persons.findFirst({
        where: eq(schema.persons.id, fixture.childId),
      }),
      db.query.treeMembers.findFirst({
        where: and(
          eq(schema.treeMembers.treeId, fixture.treeId),
          eq(schema.treeMembers.personId, fixture.parentId),
        ),
      }),
      db.query.treeUnions.findFirst({
        where: and(
          eq(schema.treeUnions.treeId, fixture.treeId),
          eq(schema.treeUnions.unionId, fixture.unionId),
        ),
      }),
      db.query.treeParentChildRelationships.findFirst({
        where: and(
          eq(schema.treeParentChildRelationships.treeId, fixture.treeId),
          eq(
            schema.treeParentChildRelationships.parentChildRelationshipId,
            fixture.parentRelationshipId,
          ),
        ),
      }),
      db.query.treeShares.findFirst({
        where: eq(schema.treeShares.treeId, fixture.treeId),
      }),
    ])
  const parentRelationship = await db.query.parentChildRelationships.findFirst({
    where: eq(schema.parentChildRelationships.id, fixture.parentRelationshipId),
  })

  expect(tree?.deletedAt).not.toBeNull()
  expect(tree?.revision).toBe(2)
  expect(member?.deletedAt).not.toBeNull()
  expect(member?.revision).toBe(2)
  expect(treeUnion?.deletedAt).not.toBeNull()
  expect(parentAssociation?.deletedAt).not.toBeNull()
  expect(parentRelationship?.deletedAt).not.toBeNull()
  expect(share).toBeUndefined()
  expect(parent?.deletedAt).toBeNull()
  expect(child?.deletedAt).toBeNull()
  expect(
    await db.query.unions.findFirst({
      where: eq(schema.unions.id, fixture.unionId),
    }),
  ).toMatchObject({ deletedAt: null })
}

beforeAll(async () => {
  await db.insert(schema.user).values([
    { id: owner.id, name: "Owner", email: owner.email, emailVerified: true },
    { id: other.id, name: "Other", email: other.email, emailVerified: true },
  ])
})

afterAll(async () => {
  // Deleting the users cascades to persons, trees, associations, receipts, and
  // sync_changes (all FK onDelete: cascade). Blob URLs are mocked, so there is
  // nothing external to clean up.
  await db
    .delete(schema.user)
    .where(inArray(schema.user.id, [owner.id, other.id]))
})

test("creates a person owned by the authenticated user", async () => {
  const id = `${RUN}-person-create`
  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Ada", updatedAt: now() }],
  })
  expect(appliedOf(result).persons).toContain(id)
  const row = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  expect(row?.name).toBe("Ada")
  expect(row?.ownerId).toBe(owner.id)
  expect(row?.deletedAt).toBeNull()
})

test("updates an existing person and bumps its revision", async () => {
  const id = `${RUN}-person-update`
  await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Before", updatedAt: now() }],
  })
  const created = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  const baseRevision = created?.revision ?? 1

  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [
      {
        id,
        name: "After",
        revision: baseRevision,
        updatedAt: now(),
      },
    ],
  })
  expect(appliedOf(result).persons).toContain(id)
  const updated = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  expect(updated?.name).toBe("After")
  expect(updated?.revision).toBe(baseRevision + 1)
})

test("skips an update whose revision does not match (optimistic concurrency)", async () => {
  const id = `${RUN}-person-conflict`
  await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Kept", updatedAt: now() }],
  })

  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Lost", revision: 999, updatedAt: now() }],
  })
  expect(appliedOf(result).persons).not.toContain(id)
  expect(result.skipped.persons).toContain(id)
  const row = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  expect(row?.name).toBe("Kept")
})

test("creates a full tree with members, a union, an event, and parent/child facts", async () => {
  const treeId = `${RUN}-tree`
  const parentA = `${RUN}-p-parentA`
  const parentB = `${RUN}-p-parentB`
  const child = `${RUN}-p-child`
  // Union endpoints must be stored in C-collation ascending order, so order
  // the two parent ids before building the union wire.
  const [firstParent, secondParent]: [string, string] =
    parentA < parentB ? [parentA, parentB] : [parentB, parentA]
  const unionId = `${RUN}-union`
  const eventId = `${RUN}-event-married`
  const relationshipId = `${RUN}-pcr`

  const result = await mutate(owner, {
    ...emptyBody(),
    trees: [
      { id: treeId, name: "Full Tree", createdAt: now(), updatedAt: now() },
    ],
    persons: [
      { id: parentA, name: "Parent A", updatedAt: now() },
      { id: parentB, name: "Parent B", updatedAt: now() },
      { id: child, name: "Child", updatedAt: now() },
    ],
    treeMembers: [
      { treeId, personId: parentA, createdAt: now(), updatedAt: now() },
      { treeId, personId: parentB, createdAt: now(), updatedAt: now() },
      { treeId, personId: child, createdAt: now(), updatedAt: now() },
    ],
    unions: [
      {
        id: unionId,
        firstPersonId: firstParent,
        secondPersonId: secondParent,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    unionEvents: [
      {
        id: eventId,
        unionId,
        type: "married",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeUnions: [{ treeId, unionId, createdAt: now(), updatedAt: now() }],
    parentChildRelationships: [
      {
        id: relationshipId,
        parentPersonId: parentA,
        childPersonId: child,
        type: "biological",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeParentChildRelationships: [
      {
        treeId,
        parentChildRelationshipId: relationshipId,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  })

  expect(appliedOf(result).trees).toContain(treeId)
  expect(appliedOf(result).unions).toContain(unionId)
  expect(appliedOf(result).unionEvents).toContain(eventId)
  expect(appliedOf(result).parentChildRelationships).toContain(relationshipId)

  expect(
    await db.query.unions.findFirst({ where: eq(schema.unions.id, unionId) }),
  ).toBeTruthy()
  const event = await db.query.unionEvents.findFirst({
    where: eq(schema.unionEvents.id, eventId),
  })
  expect(event?.type).toBe("married")
  const relationship = await db.query.parentChildRelationships.findFirst({
    where: eq(schema.parentChildRelationships.id, relationshipId),
  })
  expect(relationship?.type).toBe("biological")
})

test("direct tree deletion tombstones its local graph and orphaned parent fact", async () => {
  const fixture = await createDeletionFixture("direct")

  const response = await runDirectTreeDeletion(owner, fixture.treeId)

  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  expect(await response.json()).toEqual({ ok: true })
  await expectTreeDeletionCascade(fixture)

  const retry = await runDirectTreeDeletion(owner, fixture.treeId)
  expect(retry.status).toBe(404)
  expect(await retry.json()).toEqual({ error: "tree not found" })
})

test("tree deletion keeps a parent fact associated with another tree", async () => {
  const fixture = await createDeletionFixture("shared-parent")
  const otherTreeId = `${RUN}-delete-shared-parent-other-tree`
  await mutate(owner, {
    ...emptyBody(),
    trees: [
      {
        id: otherTreeId,
        name: "Related tree",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeMembers: [
      {
        treeId: otherTreeId,
        personId: fixture.parentId,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        treeId: otherTreeId,
        personId: fixture.childId,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeParentChildRelationships: [
      {
        treeId: otherTreeId,
        parentChildRelationshipId: fixture.parentRelationshipId,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  })

  const response = await runDirectTreeDeletion(owner, fixture.treeId)

  expect(response.status).toBe(200)
  expect(
    await db.query.parentChildRelationships.findFirst({
      where: eq(
        schema.parentChildRelationships.id,
        fixture.parentRelationshipId,
      ),
    }),
  ).toMatchObject({ deletedAt: null, revision: 1 })
  expect(
    await db.query.treeParentChildRelationships.findFirst({
      where: and(
        eq(schema.treeParentChildRelationships.treeId, otherTreeId),
        eq(
          schema.treeParentChildRelationships.parentChildRelationshipId,
          fixture.parentRelationshipId,
        ),
      ),
    }),
  ).toMatchObject({ deletedAt: null, revision: 1 })
}, 15_000)

test("mutation tree deletion uses the same cascade and rejects a deleted revision", async () => {
  const fixture = await createDeletionFixture("mutation")
  const tree = await db.query.trees.findFirst({
    where: eq(schema.trees.id, fixture.treeId),
  })
  if (!tree) throw new Error("deletion fixture tree is missing")
  expect(tree.revision).toBe(1)

  const deletion = await mutate(
    owner,
    {
      ...emptyBody(),
      trees: [
        {
          id: fixture.treeId,
          revision: tree.revision,
          updatedAt: now(),
          deletedAt: now(),
        },
      ],
    },
    `${RUN}-delete-mutation`,
  )
  expect(deletion.status).toBe("applied")
  expect(deletion.applied.trees).toEqual([fixture.treeId])
  await expectTreeDeletionCascade(fixture)

  const deletedTree = await db.query.trees.findFirst({
    where: eq(schema.trees.id, fixture.treeId),
  })
  if (!deletedTree) throw new Error("deleted fixture tree is missing")
  const retry = await runSyncMutation(
    owner,
    {
      ...emptyBody(),
      trees: [
        {
          id: fixture.treeId,
          revision: deletedTree.revision,
          updatedAt: now(),
          deletedAt: now(),
        },
      ],
    },
    `${RUN}-delete-mutation-retry`,
  )
  expect(retry.status).toBe(409)
  const conflict = (await retry.json()) as SyncMutationResponse
  expect(conflict.status).toBe("conflict")
  expect(conflict.conflict?.reason).toBe("revision-mismatch")
  expect(conflict.skipped.trees).toEqual([fixture.treeId])
  expect(
    await db.query.trees.findFirst({
      where: eq(schema.trees.id, fixture.treeId),
    }),
  ).toMatchObject({ revision: 2 })
}, 15_000)

test("is idempotent: replaying a mutation id reports alreadyApplied and writes nothing new", async () => {
  const id = `${RUN}-person-idem`
  const mutationId = `${RUN}-mutation-idem`
  const body: SyncPushRequest = {
    ...emptyBody(),
    persons: [{ id, name: "Once", updatedAt: now() }],
  }

  const first = await mutate(owner, body, mutationId)
  expect(first.status).toBe("applied")
  expect(appliedOf(first).persons).toContain(id)

  const replay = await mutate(owner, body, mutationId)
  expect(replay.status).toBe("alreadyApplied")

  // The real idempotency guarantee: exactly one receipt exists, the row was
  // created exactly once, and the replay echoes the original applied set
  // (rather than re-applying).
  const receipts = await db.query.mutationReceipts.findMany({
    where: and(
      eq(schema.mutationReceipts.userId, owner.id),
      eq(schema.mutationReceipts.mutationId, mutationId),
    ),
  })
  expect(receipts.length).toBe(1)
  expect(replay.applied.persons).toEqual(first.applied.persons)
  const onceRow = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  expect(onceRow?.name).toBe("Once")
})

test("enforces ACL: a non-owner without a share cannot mutate another's tree", async () => {
  const treeId = `${RUN}-acl-tree`
  const person = `${RUN}-acl-person`
  await mutate(owner, {
    ...emptyBody(),
    trees: [{ id: treeId, name: "Owned", createdAt: now(), updatedAt: now() }],
    persons: [{ id: person, name: "Owned Person", updatedAt: now() }],
    treeMembers: [
      { treeId, personId: person, createdAt: now(), updatedAt: now() },
    ],
  })

  const result = await mutate(other, {
    ...emptyBody(),
    treeMembers: [
      { treeId, personId: person, createdAt: now(), updatedAt: now() },
    ],
  })
  expect(appliedOf(result).treeMembers).not.toContain(
    JSON.stringify([treeId, person]),
  )
  expect(result.skipped.treeMembers).toContain(JSON.stringify([treeId, person]))
})

test("uploads a photo data URL and stores a blob URL", async () => {
  const id = `${RUN}-person-photo`
  const callsBefore = putPhotoMock.mock.calls.length
  // 1x1 transparent PNG.
  const dataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Photo", photo: dataUrl, updatedAt: now() }],
  })
  expect(appliedOf(result).persons).toContain(id)
  expect(putPhotoMock.mock.calls.length).toBe(callsBefore + 1)
  const row = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  expect(row?.photo).toMatch(
    /^https:\/\/test\.public\.blob\.vercel-storage\.com\/photos\//,
  )
})

test("skips a person whose photo data URL is malformed", async () => {
  const id = `${RUN}-person-photo-bad`
  const callsBefore = putPhotoMock.mock.calls.length
  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [
      {
        id,
        name: "Bad Photo",
        photo: "data:image/png;base64,@@not-base64@@",
        updatedAt: now(),
      },
    ],
  })
  expect(appliedOf(result).persons).not.toContain(id)
  expect(result.skipped.persons).toContain(id)
  // Decoding fails before any upload, so put must not have been called.
  expect(putPhotoMock.mock.calls.length).toBe(callsBefore)
  expect(
    await db.query.persons.findFirst({ where: eq(schema.persons.id, id) }),
  ).toBeUndefined()
})

test("replaces a stored photo on update and records a new blob URL", async () => {
  const id = `${RUN}-person-photo-replace`
  const first =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  const second =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+x+P+BAAAAAElFTkSuQmCC"

  await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Replace", photo: first, updatedAt: now() }],
  })
  const before = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })

  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [
      {
        id,
        name: "Replace",
        photo: second,
        revision: before?.revision,
        updatedAt: now(),
      },
    ],
  })
  expect(appliedOf(result).persons).toContain(id)
  const after = await db.query.persons.findFirst({
    where: eq(schema.persons.id, id),
  })
  expect(after?.photo).toMatch(
    /^https:\/\/test\.public\.blob\.vercel-storage\.com\/photos\//,
  )
  expect(after?.photo).not.toBe(before?.photo)
  // The replaced blob is deleted only after the transaction commits. `del`
  // receives `([url], options)`, so inspect the first argument of each call.
  const previousPhoto = before?.photo ?? ""
  expect(previousPhoto).toBeTruthy()
  const deletedUrls = deletePhotoMock.mock.calls.flatMap(
    (call) => call[0],
  ) as string[]
  expect(deletedUrls).toContain(previousPhoto)
})

test("deletes a pre-uploaded photo when its person update is skipped", async () => {
  const id = `${RUN}-person-photo-orphan`
  // Create the person without a photo, then attempt an update carrying a
  // data-URL photo with a stale revision. The photo is pre-uploaded before the
  // transaction, but because the update is skipped the orphan blob must be
  // deleted rather than left dangling.
  await mutate(owner, {
    ...emptyBody(),
    persons: [{ id, name: "Orphan", updatedAt: now() }],
  })
  const deletesBefore = deletePhotoMock.mock.calls.length
  const uploadsBefore = putPhotoMock.mock.calls.length
  const result = await mutate(owner, {
    ...emptyBody(),
    persons: [
      {
        id,
        name: "Orphan",
        photo:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        revision: 999,
        updatedAt: now(),
      },
    ],
  })
  expect(appliedOf(result).persons).not.toContain(id)
  expect(result.skipped.persons).toContain(id)
  expect(putPhotoMock.mock.calls.length).toBe(uploadsBefore + 1)
  expect(deletePhotoMock.mock.calls.length).toBe(deletesBefore + 1)
})

test("batched existence lookups: applies and updates multiple wires per collection", async () => {
  // Regression guard for the batched per-collection existence lookups in
  // runSyncMutation (trees, treeMembers, unionEvents, treeUnions,
  // treeParentChildRelationships). Pushing several wires per collection in one
  // mutation forces multiple ids/association keys through the single inArray
  // fetch and the composite-key maps; a wrong key or filter would drop wires.
  const tree1 = `${RUN}-b-tree1`
  const tree2 = `${RUN}-b-tree2`
  const p1 = `${RUN}-b-p1`
  const p2 = `${RUN}-b-p2`
  const p3 = `${RUN}-b-p3`
  const p4 = `${RUN}-b-p4`
  const c1 = `${RUN}-b-c1`
  const c2 = `${RUN}-b-c2`
  const [u1First, u1Second] = p1 < p2 ? [p1, p2] : [p2, p1]
  const [u2First, u2Second] = p3 < p4 ? [p3, p4] : [p4, p3]
  const u1 = `${RUN}-b-u1`
  const u2 = `${RUN}-b-u2`
  const e1 = `${RUN}-b-e1`
  const e2 = `${RUN}-b-e2`
  const r1 = `${RUN}-b-r1`
  const r2 = `${RUN}-b-r2`

  // Insert path: every wire should be applied.
  const created = await mutate(owner, {
    ...emptyBody(),
    trees: [
      { id: tree1, name: "Tree One", createdAt: now(), updatedAt: now() },
      { id: tree2, name: "Tree Two", createdAt: now(), updatedAt: now() },
    ],
    persons: [
      { id: p1, name: "P1", updatedAt: now() },
      { id: p2, name: "P2", updatedAt: now() },
      { id: p3, name: "P3", updatedAt: now() },
      { id: p4, name: "P4", updatedAt: now() },
      { id: c1, name: "C1", updatedAt: now() },
      { id: c2, name: "C2", updatedAt: now() },
    ],
    treeMembers: [
      { treeId: tree1, personId: p1, createdAt: now(), updatedAt: now() },
      { treeId: tree1, personId: p2, createdAt: now(), updatedAt: now() },
      { treeId: tree1, personId: c1, createdAt: now(), updatedAt: now() },
      { treeId: tree2, personId: p3, createdAt: now(), updatedAt: now() },
      { treeId: tree2, personId: p4, createdAt: now(), updatedAt: now() },
      { treeId: tree2, personId: c2, createdAt: now(), updatedAt: now() },
    ],
    unions: [
      {
        id: u1,
        firstPersonId: u1First,
        secondPersonId: u1Second,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: u2,
        firstPersonId: u2First,
        secondPersonId: u2Second,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    unionEvents: [
      {
        id: e1,
        unionId: u1,
        type: "married",
        eventDate: "2000-01-01",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: e2,
        unionId: u2,
        type: "married",
        eventDate: "2000-02-02",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeUnions: [
      { treeId: tree1, unionId: u1, createdAt: now(), updatedAt: now() },
      { treeId: tree2, unionId: u2, createdAt: now(), updatedAt: now() },
    ],
    parentChildRelationships: [
      {
        id: r1,
        parentPersonId: p1,
        childPersonId: c1,
        type: "biological",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: r2,
        parentPersonId: p3,
        childPersonId: c2,
        type: "biological",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeParentChildRelationships: [
      {
        treeId: tree1,
        parentChildRelationshipId: r1,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        treeId: tree2,
        parentChildRelationshipId: r2,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  })

  const applied = appliedOf(created)
  expect(applied.trees).toEqual(expect.arrayContaining([tree1, tree2]))
  expect(applied.unionEvents).toEqual(expect.arrayContaining([e1, e2]))
  expect(applied.parentChildRelationships).toEqual(
    expect.arrayContaining([r1, r2]),
  )
  for (const [treeId, personId] of [
    [tree1, p1],
    [tree1, p2],
    [tree1, c1],
    [tree2, p3],
    [tree2, p4],
    [tree2, c2],
  ]) {
    expect(applied.treeMembers).toContain(JSON.stringify([treeId, personId]))
  }
  for (const [treeId, unionId] of [
    [tree1, u1],
    [tree2, u2],
  ]) {
    expect(applied.treeUnions).toContain(JSON.stringify([treeId, unionId]))
  }
  for (const [treeId, relId] of [
    [tree1, r1],
    [tree2, r2],
  ]) {
    expect(applied.treeParentChildRelationships).toContain(
      JSON.stringify([treeId, relId]),
    )
  }

  // Capture current revisions so the update path can target them exactly.
  const [t1Row, t2Row, e1Row, e2Row, tm1, tm2, tu1, tu2, tp1, tp2] =
    await Promise.all([
      db.query.trees.findFirst({ where: eq(schema.trees.id, tree1) }),
      db.query.trees.findFirst({ where: eq(schema.trees.id, tree2) }),
      db.query.unionEvents.findFirst({ where: eq(schema.unionEvents.id, e1) }),
      db.query.unionEvents.findFirst({ where: eq(schema.unionEvents.id, e2) }),
      db.query.treeMembers.findFirst({
        where: and(
          eq(schema.treeMembers.treeId, tree1),
          eq(schema.treeMembers.personId, p1),
        ),
      }),
      db.query.treeMembers.findFirst({
        where: and(
          eq(schema.treeMembers.treeId, tree2),
          eq(schema.treeMembers.personId, p3),
        ),
      }),
      db.query.treeUnions.findFirst({
        where: and(
          eq(schema.treeUnions.treeId, tree1),
          eq(schema.treeUnions.unionId, u1),
        ),
      }),
      db.query.treeUnions.findFirst({
        where: and(
          eq(schema.treeUnions.treeId, tree2),
          eq(schema.treeUnions.unionId, u2),
        ),
      }),
      db.query.treeParentChildRelationships.findFirst({
        where: and(
          eq(schema.treeParentChildRelationships.treeId, tree1),
          eq(schema.treeParentChildRelationships.parentChildRelationshipId, r1),
        ),
      }),
      db.query.treeParentChildRelationships.findFirst({
        where: and(
          eq(schema.treeParentChildRelationships.treeId, tree2),
          eq(schema.treeParentChildRelationships.parentChildRelationshipId, r2),
        ),
      }),
    ])

  // Update path: re-push existing wires with the captured base revisions. This
  // proves the batched maps return existing rows (rather than re-inserting /
  // skipping) for every newly-batched collection.
  const updated = await mutate(owner, {
    ...emptyBody(),
    trees: [
      {
        id: tree1,
        name: "Tree One (renamed)",
        revision: t1Row?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: tree2,
        name: "Tree Two (renamed)",
        revision: t2Row?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    unionEvents: [
      {
        id: e1,
        unionId: u1,
        type: "divorced",
        eventDate: "2010-01-01",
        revision: e1Row?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: e2,
        unionId: u2,
        type: "divorced",
        eventDate: "2010-02-02",
        revision: e2Row?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeMembers: [
      {
        treeId: tree1,
        personId: p1,
        revision: tm1?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        treeId: tree2,
        personId: p3,
        revision: tm2?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeUnions: [
      {
        treeId: tree1,
        unionId: u1,
        revision: tu1?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        treeId: tree2,
        unionId: u2,
        revision: tu2?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeParentChildRelationships: [
      {
        treeId: tree1,
        parentChildRelationshipId: r1,
        revision: tp1?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        treeId: tree2,
        parentChildRelationshipId: r2,
        revision: tp2?.revision,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  })

  const reApplied = appliedOf(updated)
  expect(reApplied.trees).toEqual(expect.arrayContaining([tree1, tree2]))
  expect(reApplied.unionEvents).toEqual(expect.arrayContaining([e1, e2]))
  expect(reApplied.treeMembers).toContain(JSON.stringify([tree1, p1]))
  expect(reApplied.treeMembers).toContain(JSON.stringify([tree2, p3]))
  expect(reApplied.treeUnions).toContain(JSON.stringify([tree1, u1]))
  expect(reApplied.treeUnions).toContain(JSON.stringify([tree2, u2]))
  expect(reApplied.treeParentChildRelationships).toContain(
    JSON.stringify([tree1, r1]),
  )
  expect(reApplied.treeParentChildRelationships).toContain(
    JSON.stringify([tree2, r2]),
  )

  // The updates actually took effect on the single-key collections.
  const renamed = await db.query.trees.findFirst({
    where: eq(schema.trees.id, tree1),
  })
  expect(renamed?.name).toBe("Tree One (renamed)")
  const divorced = await db.query.unionEvents.findFirst({
    where: eq(schema.unionEvents.id, e1),
  })
  expect(divorced?.type).toBe("divorced")
}, 30000)

test("batched member removal: tombstones union and parent associations across multiple removals", async () => {
  // Regression guard for tombstonePersonReferencesInTrees: removing several
  // members in one mutation must tombstone every tree-scoped union and
  // parent-child association any removed person participates in, in a fixed
  // number of queries rather than four per removal.
  const treeId = `${RUN}-rm-tree`
  const a = `${RUN}-rm-a`
  const b = `${RUN}-rm-b`
  const child1 = `${RUN}-rm-c1`
  const child2 = `${RUN}-rm-c2`
  const [uFirst, uSecond] = a < b ? [a, b] : [b, a]
  const unionId = `${RUN}-rm-u`
  const r1 = `${RUN}-rm-r1`
  const r2 = `${RUN}-rm-r2`

  await mutate(owner, {
    ...emptyBody(),
    trees: [
      { id: treeId, name: "Removals", createdAt: now(), updatedAt: now() },
    ],
    persons: [
      { id: a, name: "A", updatedAt: now() },
      { id: b, name: "B", updatedAt: now() },
      { id: child1, name: "Child1", updatedAt: now() },
      { id: child2, name: "Child2", updatedAt: now() },
    ],
    treeMembers: [
      { treeId, personId: a, createdAt: now(), updatedAt: now() },
      { treeId, personId: b, createdAt: now(), updatedAt: now() },
      { treeId, personId: child1, createdAt: now(), updatedAt: now() },
      { treeId, personId: child2, createdAt: now(), updatedAt: now() },
    ],
    unions: [
      {
        id: unionId,
        firstPersonId: uFirst,
        secondPersonId: uSecond,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeUnions: [{ treeId, unionId, createdAt: now(), updatedAt: now() }],
    parentChildRelationships: [
      {
        id: r1,
        parentPersonId: a,
        childPersonId: child1,
        type: "biological",
        createdAt: now(),
        updatedAt: now(),
      },
      {
        id: r2,
        parentPersonId: b,
        childPersonId: child2,
        type: "biological",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
    treeParentChildRelationships: [
      {
        treeId,
        parentChildRelationshipId: r1,
        createdAt: now(),
        updatedAt: now(),
      },
      {
        treeId,
        parentChildRelationshipId: r2,
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  })

  const [memberA, memberChild1, memberChild2] = await Promise.all([
    db.query.treeMembers.findFirst({
      where: and(
        eq(schema.treeMembers.treeId, treeId),
        eq(schema.treeMembers.personId, a),
      ),
    }),
    db.query.treeMembers.findFirst({
      where: and(
        eq(schema.treeMembers.treeId, treeId),
        eq(schema.treeMembers.personId, child1),
      ),
    }),
    db.query.treeMembers.findFirst({
      where: and(
        eq(schema.treeMembers.treeId, treeId),
        eq(schema.treeMembers.personId, child2),
      ),
    }),
  ])

  const result = await mutate(owner, {
    ...emptyBody(),
    treeMembers: [
      {
        treeId,
        personId: a,
        revision: memberA?.revision,
        updatedAt: now(),
        deletedAt: now(),
      },
      {
        treeId,
        personId: child1,
        revision: memberChild1?.revision,
        updatedAt: now(),
        deletedAt: now(),
      },
      {
        treeId,
        personId: child2,
        revision: memberChild2?.revision,
        updatedAt: now(),
        deletedAt: now(),
      },
    ],
  })

  const appliedResult = appliedOf(result)
  expect(appliedResult.treeMembers).toContain(JSON.stringify([treeId, a]))
  expect(appliedResult.treeMembers).toContain(JSON.stringify([treeId, child1]))
  expect(appliedResult.treeMembers).toContain(JSON.stringify([treeId, child2]))

  // Removing A tombstones the couple's union; removing A/child1 tombstones r1;
  // removing child2 tombstones r2. B stays, so it must remain a member and its
  // person row is untouched.
  const tombstonedUnion = await db.query.treeUnions.findFirst({
    where: and(
      eq(schema.treeUnions.treeId, treeId),
      eq(schema.treeUnions.unionId, unionId),
    ),
  })
  expect(tombstonedUnion?.deletedAt).not.toBeNull()

  for (const relationshipId of [r1, r2]) {
    const tombstonedParent =
      await db.query.treeParentChildRelationships.findFirst({
        where: and(
          eq(schema.treeParentChildRelationships.treeId, treeId),
          eq(
            schema.treeParentChildRelationships.parentChildRelationshipId,
            relationshipId,
          ),
        ),
      })
    expect(tombstonedParent?.deletedAt).not.toBeNull()
  }

  const remainingB = await db.query.treeMembers.findFirst({
    where: and(
      eq(schema.treeMembers.treeId, treeId),
      eq(schema.treeMembers.personId, b),
    ),
  })
  expect(remainingB?.deletedAt).toBeNull()

  // Memberships are removed, but the person rows themselves are not deleted.
  for (const personId of [a, child1, child2]) {
    const removedMember = await db.query.treeMembers.findFirst({
      where: and(
        eq(schema.treeMembers.treeId, treeId),
        eq(schema.treeMembers.personId, personId),
      ),
    })
    expect(removedMember?.deletedAt).not.toBeNull()
    const person = await db.query.persons.findFirst({
      where: eq(schema.persons.id, personId),
    })
    expect(person?.deletedAt).toBeNull()
  }
}, 30000)
