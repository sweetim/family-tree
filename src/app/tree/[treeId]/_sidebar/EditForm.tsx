import {
  Baby,
  Crosshair,
  GitMerge,
  Heart,
  Network,
  Trash2,
  Users,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { type FormEvent, useMemo, useState } from "react"
import { useConfirm } from "@/components/Confirm"
import { Section } from "@/components/Section"
import {
  type FamilyStore,
  type TreeMeta,
  useMembersOf,
  useMemberTrees,
} from "@/store"
import { ancestorsOf, childrenOf, descendantsOf, type Person } from "@/types"
import { PersonFields } from "./PersonFields"
import {
  type Fields,
  fieldsFrom,
  ghostBtn,
  inputCls,
  primaryBtn,
  toInput,
} from "./shared"

const chip =
  "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs text-slate-700"
const chipX =
  "flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-100 hover:text-red-600"

export function EditForm({
  family,
  treeId,
  allTrees,
  person,
  onSelect,
  onFocus,
  onClose,
}: {
  family: FamilyStore
  treeId: string
  allTrees: TreeMeta[]
  person: Person
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onClose: () => void
}) {
  const { people } = family
  const [fields, setFields] = useState<Fields>(fieldsFrom(person))
  const router = useRouter()
  const navigate = (to: string) => router.push(to)
  const confirm = useConfirm()

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
  const mergeMembers = useMembersOf(mergeTreeId || undefined)
  const mergeCandidates = useMemo(
    () => mergeMembers.filter((m) => m.id !== person.id),
    [mergeMembers, person.id],
  )

  const spouses = person.spouseIds
    .map((id) => people[id])
    .filter((p): p is Person => !!p)
  const parents = person.parents
    .map((link) => ({ link, person: people[link.id] }))
    .filter(
      (x): x is { link: (typeof person.parents)[number]; person: Person } =>
        !!x.person,
    )
  const children = childrenOf(people, person.id)
  const linkable = Object.values(people).filter(
    (p) => p.id !== person.id && !person.spouseIds.includes(p.id),
  )

  // Linking an ancestor as a child (or a descendant as a parent) would
  // make someone their own ancestor, so those candidates are excluded.
  const ancestors = ancestorsOf(people, person.id)
  const descendants = descendantsOf(people, person.id)
  const parentCandidates = Object.values(people).filter(
    (p) =>
      p.id !== person.id
      && !person.parents.some((l) => l.id === p.id)
      && !descendants.has(p.id),
  )
  const childCandidates = Object.values(people).filter(
    (p) =>
      p.id !== person.id
      && p.parents.length < 2
      && !p.parents.some((l) => l.id === person.id)
      && !ancestors.has(p.id),
  )

  // Married couples where both partners are eligible — offered as a single
  // option that links both parents at once (needs both parent slots free).
  const candidateIds = new Set(parentCandidates.map((p) => p.id))
  const coupleCandidates: [Person, Person][] = []
  if (person.parents.length === 0) {
    for (const p of parentCandidates) {
      for (const sid of p.spouseIds) {
        const spouse = people[sid]
        if (p.id < sid && candidateIds.has(sid) && spouse)
          coupleCandidates.push([p, spouse])
      }
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const input = toInput(fields)
    if (!input.name) return
    family.updatePerson(person.id, input)
  }

  return (
    <div className="animate-slide-up space-y-5">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-soft"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-800">
              Edit member
            </h2>
            <p className="text-xs text-slate-400">{person.name}</p>
          </div>
          <button
            type="button"
            title={`Show only ${person.name}'s blood relatives and their spouses`}
            onClick={() => onFocus(person.id)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-cobalt-50 px-3 py-1.5 text-xs font-medium text-cobalt-600 transition-colors hover:bg-cobalt-100"
          >
            <Crosshair className="h-3.5 w-3.5" /> View their family
          </button>
        </div>

        <PersonFields
          fields={fields}
          onChange={setFields}
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
          <div className="flex flex-wrap gap-1.5">
            {spouses.length === 0 && (
              <p className="text-xs text-slate-400">None</p>
            )}
            {spouses.map((s) => (
              <span
                key={s.id}
                className={chip}
              >
                <button
                  type="button"
                  className="font-medium hover:text-cobalt-700 hover:underline"
                  onClick={() => onSelect(s.id)}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  title="Remove marriage"
                  className={chipX}
                  onClick={() => family.unlinkSpouse(person.id, s.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
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

        <Section
          title="Parents"
          icon={Users}
          count={parents.length}
        >
          {parents.length === 0 && (
            <p className="text-xs text-slate-400">None</p>
          )}
          <div className="space-y-1.5">
            {parents.map(({ link, person: par }) => (
              <div
                key={par.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5"
              >
                <button
                  type="button"
                  className="text-xs font-medium text-slate-700 hover:text-cobalt-700 hover:underline"
                  onClick={() => onSelect(par.id)}
                >
                  {par.name}
                </button>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500">
                    <input
                      type="checkbox"
                      checked={!!link.adopted}
                      onChange={(e) =>
                        family.setParentAdopted(
                          person.id,
                          par.id,
                          e.target.checked,
                        )
                      }
                    />
                    adopted
                  </label>
                  <button
                    type="button"
                    title="Remove parent link"
                    className={chipX}
                    onClick={() => family.removeParent(person.id, par.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {person.parents.length < 2 && parentCandidates.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                for (const id of e.target.value.split("|").filter(Boolean)) {
                  family.addParent(person.id, id)
                }
              }}
              className={inputCls}
            >
              <option value="">+ Link existing person as parent…</option>
              {coupleCandidates.length > 0 && (
                <optgroup label="Couples (links both)">
                  {coupleCandidates.map(([a, b]) => (
                    <option
                      key={`${a.id}|${b.id}`}
                      value={`${a.id}|${b.id}`}
                    >
                      {a.name} &amp; {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Individuals">
                {parentCandidates.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                  >
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
        </Section>

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
        </Section>

        {otherTrees.length > 0 && (
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
              {otherTrees.map((t) => (
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
                  if (!ok) return
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
          if (
            await confirm({
              title: "Delete member",
              message: `Delete ${person.name} from ALL trees?`,
              confirmText: "Delete",
              tone: "danger",
            })
          ) {
            family.deletePerson(person.id)
            onClose()
          }
        }}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-50 active:scale-95"
      >
        <Trash2 className="h-4 w-4" /> Delete {person.name}
      </button>
    </div>
  )
}
