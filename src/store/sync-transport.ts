/** HTTP transport for paginated sync, tree manifests, and tree snapshots. */
import type {
  SyncPullResponse,
  TreeManifestItem,
  TreeManifestResponse,
  TreeSnapshotResponse,
} from "../sync/types"
import {
  EPOCH,
  RECORD_COLLECTIONS,
  SNAPSHOT_RECORD_COLLECTIONS,
} from "./state-internals"

export async function fetchFullPull(): Promise<SyncPullResponse> {
  let nextCursor: string | undefined
  let aggregate: SyncPullResponse | undefined
  do {
    const parameters = new URLSearchParams({ since: EPOCH })
    if (nextCursor) parameters.set("pageCursor", nextCursor)
    const response = await fetch(`/api/sync?${parameters}`, {
      credentials: "include",
    })
    if (!response.ok) throw new Error(`pull failed: ${response.status}`)
    const page = (await response.json()) as SyncPullResponse
    if (aggregate && page.serverTime !== aggregate.serverTime) {
      throw new Error("sync pull changed while loading")
    }
    if (!aggregate) {
      aggregate = page
    } else {
      for (const collection of RECORD_COLLECTIONS) {
        aggregate.own[collection].push(...(page.own[collection] as never[]))
      }
      const sharedByTree = new Map(
        aggregate.shared.map((shared) => [shared.tree.id, shared]),
      )
      for (const sharedPage of page.shared) {
        const shared = sharedByTree.get(sharedPage.tree.id)
        if (!shared) {
          aggregate.shared.push(sharedPage)
          sharedByTree.set(sharedPage.tree.id, sharedPage)
          continue
        }
        for (const collection of SNAPSHOT_RECORD_COLLECTIONS) {
          shared[collection].push(...(sharedPage[collection] as never[]))
        }
      }
      aggregate.nextCursor = page.nextCursor
    }
    nextCursor = page.nextCursor
  } while (nextCursor)
  if (!aggregate) throw new Error("sync pull returned no pages")
  return aggregate
}

export async function fetchTreeManifest(): Promise<TreeManifestItem[]> {
  const trees: TreeManifestItem[] = []
  let cursor: string | undefined
  do {
    const parameters = new URLSearchParams({ limit: "100" })
    if (cursor) parameters.set("cursor", cursor)
    const response = await fetch(`/api/trees?${parameters}`, {
      credentials: "include",
    })
    if (!response.ok)
      throw new Error(`tree manifest failed: ${response.status}`)
    const page = (await response.json()) as TreeManifestResponse
    trees.push(...page.trees)
    cursor = page.nextCursor
  } while (cursor)
  return trees
}

export async function fetchTreeSnapshot(
  treeId: string,
): Promise<TreeSnapshotResponse> {
  const basePath = `/api/trees/${encodeURIComponent(treeId)}/snapshot`
  let restartCount = 0
  while (true) {
    let nextCursor: string | undefined
    let aggregate: TreeSnapshotResponse | undefined
    do {
      const path = nextCursor
        ? `${basePath}?pageCursor=${encodeURIComponent(nextCursor)}`
        : basePath
      const response = await fetch(path, { credentials: "include" })
      if (response.status === 409 && restartCount === 0) {
        restartCount++
        aggregate = undefined
        nextCursor = undefined
        break
      }
      if (!response.ok) {
        throw Object.assign(
          new Error(`tree snapshot failed: ${response.status}`),
          { status: response.status },
        )
      }
      const page = (await response.json()) as TreeSnapshotResponse
      if (
        aggregate
        && (page.tree.id !== aggregate.tree.id
          || page.syncVersion !== aggregate.syncVersion)
      ) {
        throw new Error("tree snapshot changed while loading")
      }
      if (aggregate) {
        const current = aggregate
        aggregate = {
          ...current,
          records: Object.fromEntries(
            SNAPSHOT_RECORD_COLLECTIONS.map((collection) => [
              collection,
              [...current.records[collection], ...page.records[collection]],
            ]),
          ) as TreeSnapshotResponse["records"],
          ancestorTrees: [
            ...(current.ancestorTrees ?? []),
            ...(page.ancestorTrees ?? []),
          ],
          nextCursor: page.nextCursor,
        }
      } else {
        aggregate = page
      }
      nextCursor = page.nextCursor
    } while (nextCursor)
    if (aggregate && !aggregate.nextCursor) return aggregate
    if (restartCount > 0) continue
  }
}
