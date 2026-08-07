import { neon } from "@neondatabase/serverless"
import { purgeTombstones, type CountRow } from "../src/server/purge-tombstones"

function printCounts(title: string, rows: readonly CountRow[]): void {
  if (rows.length === 0) return
  const longest = Math.max(...rows.map((row) => row.table_name.length))
  console.log(title)
  for (const row of rows) {
    console.log(`  ${row.table_name.padEnd(longest)}  tombstoned=${row.count}`)
  }
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string to the environment before running db:purge-tombstones.",
    )
  }

  const shouldApply = process.argv.includes("--apply")
  const result = await purgeTombstones(neon(databaseUrl), { apply: shouldApply })

  printCounts("Tombstoned rows by table:", result.before)
  console.log(`Total tombstoned rows: ${result.totalBefore}`)

  if (result.blocked.length > 0) {
    console.warn(
      "Some tombstoned parents still have ACTIVE dependents and will be skipped (cascade would delete live data). Run `bun run db:validate` to repair:",
    )
    for (const row of result.blocked) {
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
  for (const step of result.deletedByStep) {
    console.log(`  ${step.label}: removed ${step.deleted}`)
  }

  printCounts("\nRemaining tombstoned rows by table:", result.after)
  console.log(`Total removed: ${result.totalDeleted}`)
  console.log(`Total tombstoned rows remaining: ${result.totalAfter}`)
}

try {
  await run()
} catch (error) {
  console.error("Tombstone purge could not complete.")
  console.error(error instanceof Error ? error.message : String(error))
  console.error(
    "Confirm DATABASE_URL points to the intended reachable Neon database and retry db:purge-tombstones.",
  )
  process.exitCode = 1
}
