import { useEffect, useMemo, useRef, useState } from "react"
import { useToast } from "@/components/Toast"
import type {
  SyncRecordSet,
  TreeActivityChange,
  TreeActivityResponse,
} from "@/sync/types"
import type { UnionEventType } from "@/types"

export type ActivityIcon = "add" | "edit" | "remove" | "relationship" | "tree"

export type ActivityEntry = {
  version: number
  createdAt: string
  icon: ActivityIcon
  text: string
  authorName: string | null
}

export type NameResolver = (personId: string) => string | undefined

/**
 * Friendly label for each union (marriage/divorce/…) event type. The change
 * log stores the event's `type`; we render a phrase the reader recognizes.
 */
const UNION_EVENT_LABEL: Record<UnionEventType, string> = {
  relationship_started: "a relationship",
  engaged: "an engagement",
  married: "a marriage",
  civil_union: "a civil union",
  domestic_partnership: "a domestic partnership",
  separated: "a separation",
  reconciled: "a reconciliation",
  divorced: "a divorce",
  annulled: "an annulment",
  relationship_ended: "a relationship ending",
}

function personDisplayName(name: string, familyName?: string): string {
  return familyName && familyName.length > 0 ? `${name} ${familyName}` : name
}

/** "A", "A and B", or "A, B, and N more". */
function joinNames(names: string[]): string {
  if (names.length === 0) return ""
  if (names.length === 1) return names[0] as string
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more`
}

/**
 * Build a "{verb} {names}" sentence, collapsing to a count when none of the
 * affected people can be named (e.g. they were deleted and are no longer in
 * the loaded tree), so we never render "a person and a person".
 */
function personAction(verb: string, names: string[]): string {
  if (names.every((name) => name === "a person")) {
    return names.length === 1
      ? `${verb} a person`
      : `${verb} ${names.length} people`
  }
  return `${verb} ${joinNames(names)}`
}

function isFresh(revision: number | undefined): boolean {
  // `revision` starts at 1 on creation and increments on each update, so a
  // stored record at revision 1 was created by this change; anything higher
  // was edited (or, for unions/relationships, merely re-touched by a cascade).
  return (revision ?? 1) <= 1
}

/**
 * Reduce one change-log entry (the records touched by a single applied
 * mutation) to a single human-readable timeline line, choosing the most
 * salient action by priority. Names of people who are no longer in the loaded
 * tree fall back to "a person".
 */
export function summarizeChange(
  change: TreeActivityChange,
  resolveName: NameResolver,
): ActivityEntry {
  const { records, version, createdAt, author } = change
  const base = { version, createdAt, authorName: author?.name ?? null }

  const added: string[] = []
  const edited: string[] = []
  const removed: string[] = []
  for (const wire of records.persons) {
    if ("deletedAt" in wire) {
      removed.push(resolveName(wire.id) ?? "a person")
    } else if (isFresh(wire.revision)) {
      added.push(personDisplayName(wire.name, wire.familyName))
    } else {
      edited.push(personDisplayName(wire.name, wire.familyName))
    }
  }

  if (removed.length > 0) {
    return { ...base, icon: "remove", text: personAction("Removed", removed) }
  }
  if (added.length > 0) {
    return { ...base, icon: "add", text: personAction("Added", added) }
  }
  if (edited.length > 0) {
    return { ...base, icon: "edit", text: personAction("Edited", edited) }
  }

  const events = records.unionEvents.filter(
    (wire): wire is typeof wire & { type: UnionEventType } =>
      !("deletedAt" in wire),
  )
  const event = events[0]
  if (events.length === 1 && event) {
    return {
      ...base,
      icon: "relationship",
      text: `Recorded ${UNION_EVENT_LABEL[event.type]}`,
    }
  }
  if (events.length > 1) {
    return {
      ...base,
      icon: "relationship",
      text: `Recorded ${events.length} relationship events`,
    }
  }

  const addedRelationships = records.unions.filter(
    (wire) => !("deletedAt" in wire) && isFresh(wire.revision),
  ).length
  if (addedRelationships > 0) {
    return {
      ...base,
      icon: "relationship",
      text:
        addedRelationships === 1
          ? "Added a relationship"
          : `Added ${addedRelationships} relationships`,
    }
  }

  const removedRelationships = records.unions.filter(
    (wire) => "deletedAt" in wire,
  ).length
  if (removedRelationships > 0) {
    return {
      ...base,
      icon: "remove",
      text:
        removedRelationships === 1
          ? "Removed a relationship"
          : `Removed ${removedRelationships} relationships`,
    }
  }

  const addedLinks = records.parentChildRelationships.filter(
    (wire) => !("deletedAt" in wire) && isFresh(wire.revision),
  ).length
  if (addedLinks > 0) {
    return {
      ...base,
      icon: "add",
      text: "Linked a parent and child",
    }
  }

  const removedLinks = records.parentChildRelationships.filter(
    (wire) => "deletedAt" in wire,
  ).length
  if (removedLinks > 0) {
    return { ...base, icon: "remove", text: "Removed a parent-child link" }
  }

  if (records.trees.some((wire) => !("deletedAt" in wire))) {
    return { ...base, icon: "tree", text: "Updated tree settings" }
  }

  return { ...base, icon: "tree", text: "Tree updated" }
}

/**
 * Compact relative-time label ("just now", "5m ago", "yesterday", "Mon 5",
 * "Mon 5, 2024"). `now` is a parameter so tests can pin the present.
 */
export function formatRelativeTime(
  createdAt: string,
  now: Date = new Date(),
): string {
  const then = new Date(createdAt).getTime()
  const seconds = Math.round((now.getTime() - then) / 1000)
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  const thenDate = new Date(createdAt)
  const month = thenDate.toLocaleString("en-US", { month: "short" })
  if (thenDate.getFullYear() === now.getFullYear()) {
    return `${month} ${thenDate.getDate()}`
  }
  return `${month} ${thenDate.getDate()}, ${thenDate.getFullYear()}`
}

function emptyRecordSet(): SyncRecordSet {
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

/**
 * Loads a tree's recent activity feed and summarizes each change-log entry to
 * a display line. `resolveName` turns person ids into current names (people
 * deleted since are reported as "a person"); pass one bound to the loaded
 * family so removals still read naturally while the tree is open.
 */
export function useTreeActivity(
  treeId: string,
  resolveName: NameResolver,
): { entries: ActivityEntry[]; loading: boolean } {
  const toast = useToast()
  const [changes, setChanges] = useState<TreeActivityChange[]>([])
  const [loading, setLoading] = useState(true)
  const refreshVersion = useRef(0)

  useEffect(() => {
    let current = true
    const currentRefresh = ++refreshVersion.current
    setLoading(true)
    fetch(`/api/trees/${encodeURIComponent(treeId)}/activity?limit=30`, {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`load failed: ${response.status}`)
        const data = (await response.json()) as TreeActivityResponse
        if (current && currentRefresh === refreshVersion.current) {
          setChanges(data.changes)
        }
      })
      .catch((error: unknown) => {
        console.error(error)
        if (current && currentRefresh === refreshVersion.current) {
          toast("Couldn't load activity.", "error")
        }
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [treeId, toast])

  const entries = useMemo(
    () => changes.map((change) => summarizeChange(change, resolveName)),
    [changes, resolveName],
  )

  return { entries, loading }
}

export { emptyRecordSet }
