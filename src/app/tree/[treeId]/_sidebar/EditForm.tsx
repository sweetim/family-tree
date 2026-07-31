import { Baby, GitMerge, Heart, Network, Plus, Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useConfirm } from "@/components/Confirm"
import { Section } from "@/components/Section"
import { photoProxyUrl } from "@/lib/image"
import { findRoots } from "@/lib/layout"
import { useTreeEditMode } from "@/lib/tree-edit-mode"
import {
  type FamilyStore,
  type TreeMeta,
  type TreeSeed,
  useMembersOf,
  useMemberTrees,
  useTreeIndex,
} from "@/store"
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  type FamilyData,
  type Person,
} from "@/types"
import { GenderIcon } from "./GenderIcon"
import { ParentsSection } from "./ParentsSection"
import { PersonFields } from "./PersonFields"
import {
  chip,
  chipX,
  type Fields,
  fieldsFrom,
  ghostBtn,
  inputCls,
  primaryBtn,
  toInput,
} from "./shared"

export function EditForm({
  family,
  treeId,
  allTrees,
  person,
  onSelect,
  onClose,
}: {
  family: FamilyStore
  treeId: string
  allTrees: TreeMeta[]
  person: Person
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const { people } = family
  const [fields, setFields] = useState<Fields>(fieldsFrom(person))
  const router = useRouter()
  const navigate = (to: string) => router.push(to)
  const confirm = useConfirm()
  const { getEditingSession } = useTreeEditMode()
  const { createTree } = useTreeIndex()

  const rootGroup = useMemo(
    () => findRoots(people).find((r) => r.heads.includes(person.id)),
    [people, person.id],
  )
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (creating) nameInputRef.current?.select()
  }, [creating])

  const otherTrees = allTrees.filter((t) => t.id !== treeId)
  const [linkTreeId, setLinkTreeId] = useState("")
  const memberTrees = useMemberTrees(person.id).filter((t) => t.id !== treeId)
  const otherTreeMembers = useMembersOf(linkTreeId || undefined)
  const linkCandidates = useMemo(
    () =>
      otherTreeMembers.filter(
        (m) => m.id !== person.id && !person.spouseIds.includes(m.id),
      ),
    [otherTreeMembers, person.id, person.spouseIds],
  )
  const [mergeTreeId, setMergeTreeId] = useState("")
  const mergeTrees = otherTrees.filter((tree) => tree.role !== "viewer")
  const mergeMembers = useMembersOf(mergeTreeId || undefined)
  const mergeCandidates = useMemo(
    () => mergeMembers.filter((m) => m.id !== person.id),
    [mergeMembers, person.id],
  )

  const spouses = person.spouseIds
    .map((id) => people[id])
    .filter((p): p is Person => !!p)
  const children = childrenOf(people, person.id)
  const linkable = Object.values(people).filter(
    (p) => p.id !== person.id && !person.spouseIds.includes(p.id),
  )

  // Linking an ancestor as a child would make someone their own ancestor,
  // so those candidates are excluded.
  const ancestors = ancestorsOf(people, person.id)
  const childCandidates = Object.values(people).filter(
    (p) =>
      p.id !== person.id
      && p.parents.length < 2
      && !p.parents.some((l) => l.id === person.id)
      && !ancestors.has(p.id),
  )

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = toInput(fields)
    if (!input.name) return
    family.updatePerson(person.id, input)
  }

  function openCreateFamily() {
    if (!rootGroup) return
    const heads = rootGroup.heads.map((id) => people[id]).filter(Boolean)
    setNewName(
      heads.length >= 2 && heads[0] && heads[1]
        ? `${heads[0].name} & ${heads[1].name} family`
        : `${person.name}'s family`,
    )
    setCreating(true)
  }

  function createFamily() {
    const trimmed = newName.trim()
    if (!trimmed || !rootGroup) return
    const include = new Set<string>()
    for (const headId of rootGroup.heads) {
      if (!people[headId]) continue
      include.add(headId)
      for (const descendant of descendantsOf(people, headId))
        include.add(descendant)
    }
    for (const id of [...include]) {
      for (const sid of people[id]?.spouseIds ?? []) {
        if (people[sid]) include.add(sid)
      }
    }
    const seededPeople: FamilyData = {}
    for (const id of include) {
      const includedPerson = people[id]
      if (!includedPerson) continue
      seededPeople[id] = {
        ...includedPerson,
        parents: includedPerson.parents.filter((link) => include.has(link.id)),
        spouseIds: includedPerson.spouseIds.filter((spouseId) =>
          include.has(spouseId),
        ),
        marriageDates: Object.fromEntries(
          Object.entries(includedPerson.marriageDates).filter(([spouseId]) =>
            include.has(spouseId),
          ),
        ),
      }
    }
    const seed: TreeSeed = { people: seededPeople }
    const newTreeId = createTree(trimmed, seed)
    setCreating(false)
    navigate(`/tree/${newTreeId}`)
  }

  return (
    <div className="animate-slide-up space-y-5">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-soft"
      >
        <div>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">
            Edit member
          </h2>
          <p className="text-xs text-slate-400">{person.name}</p>
        </div>

        <PersonFields
          fields={fields}
          onChange={setFields}
          existingPhotoUrl={
            person.photo
              ? photoProxyUrl(person.id, person.updatedAt)
              : undefined
          }
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={ghostBtn}
          >
            Close
          </button>
          <button
            type="submit"
            className={primaryBtn}
          >
            Save
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <Section
          title="Spouses"
          icon={Heart}
          count={spouses.length}
        >
          <div className="space-y-1.5">
            {spouses.length === 0 && (
              <p className="text-xs text-slate-400">None</p>
            )}
            {spouses.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5"
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-cobalt-700 hover:underline"
                  onClick={() => onSelect(s.id)}
                >
                  <GenderIcon gender={s.gender} />
                  {s.name}
                </button>
                <input
                  type="date"
                  aria-label={`Marriage date with ${s.name}`}
                  value={person.marriageDates[s.id] ?? ""}
                  onChange={(e) =>
                    family.updateSpouseDate(person.id, s.id, e.target.value)
                  }
                  className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-600 focus:border-cobalt-500 focus:outline-none focus:ring-1 focus:ring-cobalt-200"
                />
                <button
                  type="button"
                  title="Remove marriage"
                  className={chipX}
                  onClick={() => family.unlinkSpouse(person.id, s.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          {linkable.length > 0 && (
            <select
              value=""
              onChange={(e) =>
                e.target.value && family.linkSpouse(person.id, e.target.value)
              }
              className={inputCls}
            >
              <option value="">+ Link existing person as spouse…</option>
              {linkable.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                >
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Section>

        <ParentsSection
          family={family}
          treeId={treeId}
          allTrees={allTrees}
          person={person}
          onSelect={onSelect}
        />

        <Section
          title="Children"
          icon={Baby}
          count={children.length}
        >
          <div className="flex flex-wrap gap-1.5">
            {children.length === 0 && (
              <p className="text-xs text-slate-400">None</p>
            )}
            {children.map((c) => (
              <span
                key={c.id}
                className={chip}
              >
                <GenderIcon gender={c.gender} />
                <button
                  type="button"
                  className="font-medium hover:text-cobalt-700 hover:underline"
                  onClick={() => onSelect(c.id)}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>
          {childCandidates.length > 0 && (
            <select
              value=""
              onChange={(e) =>
                e.target.value && family.addParent(e.target.value, person.id)
              }
              className={inputCls}
            >
              <option value="">+ Link existing person as child…</option>
              {childCandidates.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                >
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Section>

        <Section
          title="Other families"
          icon={Network}
          count={memberTrees.length}
        >
          <div className="flex flex-wrap gap-1.5">
            {memberTrees.length === 0 && (
              <p className="text-xs text-slate-400">Only in this tree</p>
            )}
            {memberTrees.map((t) => (
              <span
                key={t.id}
                className={chip}
              >
                <button
                  type="button"
                  title={`Open ${person.name} in ${t.name}`}
                  className="font-medium hover:text-cobalt-700 hover:underline"
                  onClick={() => navigate(`/tree/${t.id}/p/${person.id}`)}
                >
                  {t.name}
                </button>
                <button
                  type="button"
                  title={`Remove ${person.name} from ${t.name}`}
                  className={chipX}
                  onClick={() => family.removeFromTree(person.id, t.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {otherTrees.length > 0 && (
            <div className="space-y-2">
              <select
                value={linkTreeId}
                onChange={(e) => setLinkTreeId(e.target.value)}
                className={inputCls}
              >
                <option value="">+ Marry someone in another tree…</option>
                {otherTrees.map((t) => (
                  <option
                    key={t.id}
                    value={t.id}
                  >
                    {t.name}
                  </option>
                ))}
              </select>
              {linkTreeId && (
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return
                    family.linkAcrossTrees(
                      person.id,
                      linkTreeId,
                      e.target.value,
                    )
                    setLinkTreeId("")
                  }}
                  className={inputCls}
                >
                  <option value="">
                    {linkCandidates.length > 0
                      ? "Who do they marry in that tree?"
                      : "No one available to marry in that tree"}
                  </option>
                  {linkCandidates.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                    >
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {rootGroup && (
            <button
              type="button"
              onClick={openCreateFamily}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
            >
              <Plus className="h-4 w-4" /> Create new family
            </button>
          )}
        </Section>

        {mergeTrees.length > 0 && (
          <Section
            title="Same person in another family"
            icon={GitMerge}
          >
            <p className="text-xs leading-relaxed text-slate-400">
              Is this {person.name} the same person as someone in another tree?
              Linking merges the two into one.
            </p>
            <select
              value={mergeTreeId}
              onChange={(e) => setMergeTreeId(e.target.value)}
              className={inputCls}
            >
              <option value="">Choose a tree…</option>
              {mergeTrees.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                >
                  {t.name}
                </option>
              ))}
            </select>
            {mergeTreeId && (
              <select
                value=""
                onChange={async (e) => {
                  const editingSession = getEditingSession(treeId)
                  if (editingSession === null) return
                  const otherId = e.target.value
                  if (!otherId) return
                  const otherName =
                    mergeCandidates.find((m) => m.id === otherId)?.name
                    ?? "that person"
                  const ok = await confirm({
                    title: "Link as same person",
                    message: `Merge ${person.name} into ${otherName}? The ${otherName} entry is kept, with any missing details filled in from ${person.name}.`,
                    confirmText: "Merge",
                    tone: "danger",
                  })
                  if (!ok || getEditingSession(treeId) !== editingSession)
                    return
                  family.mergePersons(otherId, person.id)
                  setMergeTreeId("")
                  onClose()
                }}
                className={inputCls}
              >
                <option value="">
                  {mergeCandidates.length > 0
                    ? "Select the same person…"
                    : "No one in that tree"}
                </option>
                {mergeCandidates.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                  >
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </Section>
        )}
      </div>

      <button
        type="button"
        onClick={async () => {
          const editingSession = getEditingSession(treeId)
          if (editingSession === null) return
          const confirmed = await confirm({
            title: "Remove from tree",
            message: `Remove ${person.name} from this tree?`,
            confirmText: "Remove",
          })
          if (confirmed && getEditingSession(treeId) === editingSession) {
            family.removeFromTree(person.id, treeId)
            onClose()
          }
        }}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 active:scale-95"
      >
        <Trash2 className="h-4 w-4" /> Remove from tree
      </button>

      {creating && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape (handled on the input) is the keyboard equivalent
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape handler on the input below
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in"
          onClick={(event) => {
            if (event.target === event.currentTarget) setCreating(false)
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              createFamily()
            }}
            className="w-full max-w-sm animate-scale-in rounded-2xl bg-white p-6 shadow-lift"
          >
            <h2 className="text-base font-semibold text-slate-800">
              Create new family
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-500">
              Start a new tree from {person.name}
              {rootGroup && rootGroup.heads.length >= 2
                ? " and their spouse"
                : ""}
              . They&rsquo;ll belong to both trees.
            </p>
            <input
              ref={nameInputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setCreating(false)
              }}
              placeholder="Family name"
              className={`${inputCls} mt-4`}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className={ghostBtn}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newName.trim()}
                className={primaryBtn}
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
