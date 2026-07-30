import { sql } from "drizzle-orm"
import { getDB } from "../../db"
import { MINIMUM_SEARCH_LENGTH } from "../limits"
import { requireSession } from "../session"

type SearchRow = { personId: string; name: string; treeId: string }

/** Searches accessible people without loading every accessible tree. */
export async function searchPeople(request: Request): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })

  const query = new URL(request.url).searchParams.get("query")?.trim() ?? ""
  if (query.length === 0) return Response.json({ results: [] })
  if (
    query.length < MINIMUM_SEARCH_LENGTH
    || query.length > 100
    || query.includes("\0")
  ) {
    return Response.json({ error: "invalid query" }, { status: 400 })
  }

  const db = getDB()
  const escapedQuery = query
    .toLocaleLowerCase()
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
  const pattern = `%${escapedQuery}%`
  const result = await db.execute(sql<SearchRow>`
    SELECT candidate."personId", candidate.name, candidate."treeId"
    FROM (
      SELECT DISTINCT ON (p.id)
        p.id AS "personId",
        p.name,
        m.tree_id AS "treeId",
        m.created_at
      FROM persons p
      INNER JOIN tree_members m
        ON m.person_id = p.id
        AND m.deleted_at IS NULL
      INNER JOIN trees t
        ON t.id = m.tree_id
        AND t.deleted_at IS NULL
      LEFT JOIN tree_shares s
        ON s.tree_id = t.id
        AND s.user_id = ${me.id}
      WHERE p.deleted_at IS NULL
        AND (t.owner_id = ${me.id} OR s.user_id = ${me.id})
        AND lower(p.name) LIKE ${pattern} ESCAPE '\'
      ORDER BY p.id, m.created_at, m.tree_id
    ) candidate
    ORDER BY lower(candidate.name), candidate."personId"
    LIMIT 8
  `)
  return Response.json(
    { results: result.rows as SearchRow[] },
    { headers: { "cache-control": "private, no-store" } },
  )
}
