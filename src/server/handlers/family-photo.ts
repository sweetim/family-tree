import { and, eq, inArray, isNull } from "drizzle-orm"
import { getDB } from "../../db"
import {
  parentChildRelationships,
  persons,
  treeMembers,
  treeParentChildRelationships,
} from "../../db/schema"
import { treeRole } from "../acl"
import { fetchStoredPhoto, isAllowedStoredPhotoUrl } from "../blob"
import { MAX_PHOTO_BYTES } from "../limits"
import { readBoundedBytes } from "../request"
import { requireSession } from "../session"
import { isValidSyncId } from "../sync-validation"

const OPEN_AI_IMAGE_MODEL = "gpt-image-2"
const OPEN_AI_EDITS_URL = "https://api.openai.com/v1/images/edits"
/** The gpt-image edits endpoint accepts at most 16 reference images. */
const MAX_REFERENCE_IMAGES = 16
const OPEN_AI_TIMEOUT_MS = 120_000
const PHOTO_FETCH_TIMEOUT_MS = 10_000
/** Completed/failed jobs are kept for this long before being pruned. */
const JOB_TTL_MS = 30 * 60 * 1000

const FAMILY_PHOTO_PROMPT = [
  "Analyze all the attached images and create a single family photo from exactly those people.",
  "There is one person per attached image: include exactly as many people as there are images, and do not add, invent, merge, or duplicate anyone.",
  "Keep every person's face identical to their source image — do not change facial features, age, or expression; each generated person must look the same as the original so the result is recognizable.",
  "You may change clothing, hairstyle, and pose to suit a group photo, but never the face.",
].join(" ")

type FamilyPerson = {
  id: string
  dob: string | null
  photo: string | null
}

type FamilyPhotoJob = {
  id: string
  treeId: string
  userId: string
  status: "pending" | "complete" | "failed"
  error?: string
  image?: Buffer
  createdAt: number
}

type JobStore = Map<string, FamilyPhotoJob>

/**
 * In-memory job registry on `globalThis` so it survives module reloads in dev
 * and is shared across requests in a single long-running server process. This
 * makes the feature reliable on a persistent server (`bun run dev`,
 * `next start`, a container) but not on serverless, where each instance has its
 * own memory — an accepted trade-off of the chosen design.
 */
function jobStore(): JobStore {
  const global = globalThis as unknown as { __familyPhotoJobs?: JobStore }
  if (!global.__familyPhotoJobs) global.__familyPhotoJobs = new Map()
  return global.__familyPhotoJobs
}

function pruneJobs(): void {
  const now = Date.now()
  for (const [id, job] of jobStore()) {
    if (now - job.createdAt > JOB_TTL_MS) jobStore().delete(id)
  }
}

function openAiToken(): string | null {
  const value = process.env.OPEN_AI_TOKEN
  return value && value.length > 0 ? value : null
}

/**
 * Assign each member a generation number: members with no parents in the tree
 * are generation 0; every other member is one below their latest parent.
 * Iterates over parent->child edges to a fixed point. Used only to prioritize
 * reference photos (eldest generation first) when capping at the API maximum.
 */
function generationsFor(
  personIds: Set<string>,
  parentChildEdges: Array<{ parentId: string; childId: string }>,
): Map<string, number> {
  const generations = new Map<string, number>()
  for (const id of personIds) generations.set(id, 0)
  let changed = true
  let safety = personIds.size + 1
  while (changed && safety > 0) {
    changed = false
    safety -= 1
    for (const { parentId, childId } of parentChildEdges) {
      if (!personIds.has(parentId) || !personIds.has(childId)) continue
      const parentGen = generations.get(parentId) ?? 0
      const childGen = generations.get(childId) ?? 0
      if (parentGen + 1 > childGen) {
        generations.set(childId, parentGen + 1)
        changed = true
      }
    }
  }
  return generations
}

/** Fetch one stored photo as a base64 data URL, or null if it cannot be read. */
async function fetchPhotoDataUrl(url: string): Promise<string | null> {
  if (!isAllowedStoredPhotoUrl(url)) return null
  let upstream: Response
  try {
    upstream = await fetchStoredPhoto(
      url,
      AbortSignal.timeout(PHOTO_FETCH_TIMEOUT_MS),
    )
  } catch {
    return null
  }
  if (!upstream.ok || !upstream.body) return null
  const contentType =
    upstream.headers.get("content-type")?.split(";", 1)[0]?.trim()
    ?? "image/jpeg"
  const result = await readBoundedBytes(upstream.body, MAX_PHOTO_BYTES)
  if (!result.ok) return null
  return `data:${contentType};base64,${Buffer.from(result.bytes).toString("base64")}`
}

/**
 * Runs the generation for one tree and resolves with the PNG bytes. Throws an
 * Error whose message is safe to surface to the requester. Runs outside the
 * request lifecycle (see {@link startFamilyPhoto}). When `selectedPersonIds` is
 * provided, only those members (intersected with tree membership) are included;
 * otherwise every member is included.
 */
async function renderFamilyPhoto(
  treeId: string,
  selectedPersonIds: string[] | null,
): Promise<Buffer> {
  const token = openAiToken()
  if (!token) {
    throw new Error("Family photo generation is not configured.")
  }

  const db = getDB()
  const memberRows = await db
    .select({ personId: treeMembers.personId })
    .from(treeMembers)
    .where(and(eq(treeMembers.treeId, treeId), isNull(treeMembers.deletedAt)))
  const memberIds = new Set(memberRows.map((row) => row.personId))
  if (memberIds.size === 0) throw new Error("Tree has no members.")

  const effectiveIds =
    selectedPersonIds && selectedPersonIds.length > 0
      ? new Set(selectedPersonIds.filter((id) => memberIds.has(id)))
      : memberIds
  if (effectiveIds.size === 0) {
    throw new Error("Select at least one family member.")
  }

  const [personRows, treeParentRows] = await Promise.all([
    db
      .select()
      .from(persons)
      .where(
        and(inArray(persons.id, [...effectiveIds]), isNull(persons.deletedAt)),
      ),
    db
      .select({ rel: parentChildRelationships })
      .from(treeParentChildRelationships)
      .innerJoin(
        parentChildRelationships,
        eq(
          parentChildRelationships.id,
          treeParentChildRelationships.parentChildRelationshipId,
        ),
      )
      .where(
        and(
          eq(treeParentChildRelationships.treeId, treeId),
          isNull(treeParentChildRelationships.deletedAt),
          isNull(parentChildRelationships.deletedAt),
        ),
      ),
  ])

  const people: FamilyPerson[] = personRows.map((row) => ({
    id: row.id,
    dob: row.dob,
    photo: row.photo,
  }))

  const parentChildEdges = treeParentRows
    .map((row) => row.rel)
    .filter(
      (rel) =>
        effectiveIds.has(rel.parentPersonId)
        && effectiveIds.has(rel.childPersonId),
    )
    .map((rel) => ({
      parentId: rel.parentPersonId,
      childId: rel.childPersonId,
    }))

  const generations = generationsFor(effectiveIds, parentChildEdges)

  // Reference images: prefer the eldest generation first, capped at the API max.
  const photoCandidates = people
    .filter((person) => !!person.photo)
    .sort((a, b) => {
      const generationDiff =
        (generations.get(a.id) ?? 0) - (generations.get(b.id) ?? 0)
      if (generationDiff !== 0) return generationDiff
      return (a.dob ?? "").localeCompare(b.dob ?? "")
    })
    .slice(0, MAX_REFERENCE_IMAGES)

  if (photoCandidates.length === 0) {
    throw new Error("Add photos to family members first.")
  }

  const referenceDataUrls = (
    await Promise.all(
      photoCandidates.map((person) =>
        person.photo ? fetchPhotoDataUrl(person.photo) : null,
      ),
    )
  ).filter((value): value is string => value !== null)
  if (referenceDataUrls.length === 0) {
    throw new Error("Could not load any member photos.")
  }

  console.info(
    "[family-photo] gpt-image-2 request",
    JSON.stringify({
      treeId,
      referenceImageCount: referenceDataUrls.length,
      promptLength: FAMILY_PHOTO_PROMPT.length,
      prompt: FAMILY_PHOTO_PROMPT,
    }),
  )

  let openAiResponse: Response
  try {
    openAiResponse = await fetch(OPEN_AI_EDITS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPEN_AI_IMAGE_MODEL,
        prompt: FAMILY_PHOTO_PROMPT,
        images: referenceDataUrls.map((dataUrl) => ({ image_url: dataUrl })),
        size: "1536x1024",
        quality: "medium",
        output_format: "png",
      }),
      signal: AbortSignal.timeout(OPEN_AI_TIMEOUT_MS),
    })
  } catch (err) {
    console.error("[family-photo] OpenAI request failed", err)
    throw new Error("Image generation timed out. Please try again.")
  }

  if (!openAiResponse.ok) {
    const detail = await openAiResponse.text().catch(() => "")
    console.error("OpenAI image edit failed", openAiResponse.status, detail)
    throw new Error("Image generation failed. Please try again.")
  }

  const json = (await openAiResponse.json()) as {
    data?: Array<{ b64_json?: string }>
  }
  const base64 = json.data?.[0]?.b64_json
  if (!base64) throw new Error("No image was returned.")

  return Buffer.from(base64, "base64")
}

/** Executes a job in the background, capturing the result or an error. */
async function runJob(
  job: FamilyPhotoJob,
  treeId: string,
  selectedPersonIds: string[] | null,
): Promise<void> {
  try {
    job.image = await renderFamilyPhoto(treeId, selectedPersonIds)
    job.status = "complete"
  } catch (err) {
    job.status = "failed"
    job.error = err instanceof Error ? err.message : "Image generation failed."
  }
}

/**
 * `POST /api/trees/[treeId]/family-photo` — authorizes and starts a background
 * generation job, returning its id immediately. The requester must have read
 * access to the tree. The optional JSON body `{ personIds?: string[] }` limits
 * the portrait to a subset of members; omit it to include everyone. Returns
 * `202 { id }`; `503` when `OPEN_AI_TOKEN` is unset, `401` unauthenticated,
 * `400` invalid id, `404` tree not found.
 */
export async function startFamilyPhoto(
  request: Request,
  treeId: string,
): Promise<Response> {
  if (!openAiToken()) {
    return Response.json(
      { error: "Family photo generation is not configured." },
      { status: 503 },
    )
  }
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!isValidSyncId(treeId)) {
    return Response.json({ error: "invalid tree id" }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as {
    personIds?: unknown
  } | null
  const rawPersonIds = body?.personIds
  const selectedPersonIds = Array.isArray(rawPersonIds)
    ? rawPersonIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : null

  const db = getDB()
  const role = await treeRole(db, me.id, treeId)
  if (!role) return Response.json({ error: "tree not found" }, { status: 404 })

  pruneJobs()
  const id = crypto.randomUUID()
  const job: FamilyPhotoJob = {
    id,
    treeId,
    userId: me.id,
    status: "pending",
    createdAt: Date.now(),
  }
  jobStore().set(id, job)

  // Detached: resolves after the response is sent, updating the job in place.
  void runJob(job, treeId, selectedPersonIds)

  return Response.json(
    { id },
    { status: 202, headers: { "cache-control": "private, no-store" } },
  )
}

/**
 * `GET /api/trees/[treeId]/family-photo/[jobId]` — poll a job started by
 * {@link startFamilyPhoto}. Returns `202 { status: "pending" }` while running,
 * the generated PNG (`content-type: image/png`) when complete, or `500`
 * `{ error }` on failure. `404` for an unknown or foreign job.
 */
export async function getFamilyPhoto(
  request: Request,
  treeId: string,
  jobId: string,
): Promise<Response> {
  const me = await requireSession(request)
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 })
  if (!isValidSyncId(treeId) || !isValidSyncId(jobId)) {
    return Response.json({ error: "invalid job id" }, { status: 400 })
  }

  const job = jobStore().get(jobId)
  if (!job || job.treeId !== treeId || job.userId !== me.id) {
    return Response.json({ error: "job not found" }, { status: 404 })
  }

  const noStore = { "cache-control": "private, no-store" }
  switch (job.status) {
    case "pending":
      return Response.json(
        { status: "pending" },
        { status: 202, headers: noStore },
      )
    case "failed":
      return Response.json(
        { error: job.error ?? "Image generation failed." },
        { status: 500, headers: noStore },
      )
    case "complete":
      return new Response(job.image, {
        headers: {
          "content-type": "image/png",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      })
  }
}
