import { eq, isNotNull } from "drizzle-orm"
import { getDB } from "../src/db"
import { persons } from "../src/db/schema"
import { isPhotoDataUrl, normalizePhoto } from "../src/server/blob"

/**
 * One-off backfill: every `persons.photo` that still holds a legacy base64
 * data URL is uploaded to Vercel Blob and the row rewritten with the blob URL.
 * Rows that already hold a URL (or are null) are left untouched. Idempotent.
 *
 *   bun run scripts/migrate-photos-to-blob.ts
 *
 * Requires DATABASE_URL and BLOB_READ_WRITE_TOKEN in the environment.
 */
async function main(): Promise<void> {
  const db = getDB()
  const rows = await db
    .select({ id: persons.id, ownerId: persons.ownerId, photo: persons.photo })
    .from(persons)
    .where(isNotNull(persons.photo))

  let migrated = 0
  let skipped = 0
  for (const row of rows) {
    if (!row.photo || !isPhotoDataUrl(row.photo)) {
      skipped += 1
      continue
    }
    const url = await normalizePhoto(row.ownerId, row.photo)
    await db.update(persons).set({ photo: url }).where(eq(persons.id, row.id))
    migrated += 1
    console.log(`migrated ${row.id} -> ${url}`)
  }
  console.log(`done: ${migrated} migrated, ${skipped} already migrated / null`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
