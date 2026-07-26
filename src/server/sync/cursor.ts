import { isValidSyncId } from "../sync-validation"

export type SyncCursor = { treeId: string; version: number }

export function encodeSyncCursor(cursor: SyncCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function decodeSyncCursor(
  value: string | null,
  treeId: string,
): SyncCursor | null | undefined {
  if (!value) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown
    if (!parsed || typeof parsed !== "object") return undefined
    const cursor = parsed as Record<string, unknown>
    if (
      cursor.treeId !== treeId
      || !isValidSyncId(cursor.treeId)
      || !Number.isSafeInteger(cursor.version)
      || (cursor.version as number) < 0
    ) {
      return undefined
    }
    return { treeId, version: cursor.version as number }
  } catch {
    return undefined
  }
}
