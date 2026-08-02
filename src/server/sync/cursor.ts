import { isValidSyncId } from "../sync-validation"

export type SyncCursor = { treeId: string; version: number }

/** Encode an opaque JSON value as a base64url cursor string. */
export function encodeCursorJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

/**
 * Decode a base64url JSON cursor.
 * Returns `null` when the value is absent, `undefined` when malformed. Each
 * caller validates its own shape on top of this.
 */
export function decodeCursorJson(
  value: string | null,
): unknown | null | undefined {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return undefined
  }
}

export function encodeSyncCursor(cursor: SyncCursor): string {
  return encodeCursorJson(cursor)
}

export function decodeSyncCursor(
  value: string | null,
  treeId: string,
): SyncCursor | null | undefined {
  const parsed = decodeCursorJson(value)
  if (parsed === null) return null
  if (parsed === undefined || !parsed || typeof parsed !== "object") {
    return undefined
  }
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
}
