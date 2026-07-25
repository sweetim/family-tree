import { Users, X } from "lucide-react"
import { useMemo, useState } from "react"
import { Section } from "@/components/Section"
import { type FamilyStore, type TreeMeta, useTreePeople } from "@/store"
import { descendantsOf, type Person } from "@/types"
import { chipX, inputCls } from "./shared"

export function ParentsSection({
  family,
  treeId,
  allTrees,
  person,
  onSelect,
}: {
  family: FamilyStore
  treeId: string
  allTrees: TreeMeta[]
  person: Person
  onSelect: (id: string) => void
}) {
  const { people } = family

  const parents = person.parents
    .map((link) => ({ link, person: people[link.id] }))
    .filter(
      (x): x is { link: (typeof person.parents)[number]; person: Person } =>
        !!x.person,
    )

  const descendants = descendantsOf(people, person.id)
  const parentCandidates = Object.values(people).filter(
    (p) =>
      p.id !== person.id
      && !person.parents.some((l) => l.id === p.id)
      && !descendants.has(p.id),
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

  const otherTrees = allTrees.filter((t) => t.id !== treeId)
  const [parentLinkTreeId, setParentLinkTreeId] = useState("")
  const parentLinkPeople = useTreePeople(parentLinkTreeId || undefined)
  const linkCandidates = useMemo(
    () =>
      parentLinkPeople.filter(
        (p) => p.id !== person.id && !person.parents.some((l) => l.id === p.id),
      ),
    [parentLinkPeople, person.id, person.parents],
  )
  // Married couples in the other tree where both are eligible — offered as a
  // single option (needs both parent slots free; linking one pulls the spouse
  // in automatically).
  const linkCoupleCandidates = useMemo(() => {
    if (person.parents.length !== 0) return [] as [Person, Person][]
    const byId = new Map(parentLinkPeople.map((p) => [p.id, p]))
    const candidateIdSet = new Set(linkCandidates.map((p) => p.id))
    const pairs: [Person, Person][] = []
    for (const p of linkCandidates) {
      for (const sid of p.spouseIds) {
        const spouse = byId.get(sid)
        if (p.id < sid && candidateIdSet.has(sid) && spouse)
          pairs.push([p, spouse])
      }
    }
    return pairs
  }, [parentLinkPeople, linkCandidates, person.parents.length])

  return (
    <Section
      title="Parents"
      icon={Users}
      count={parents.length}
    >
      {parents.length === 0 && <p className="text-xs text-slate-400">None</p>}
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
                    family.setParentAdopted(person.id, par.id, e.target.checked)
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
      {person.parents.length < 2 && otherTrees.length > 0 && (
        <div className="space-y-2">
          <select
            value={parentLinkTreeId}
            onChange={(e) => setParentLinkTreeId(e.target.value)}
            className={inputCls}
          >
            <option value="">+ Add parent from another tree…</option>
            {otherTrees.map((t) => (
              <option
                key={t.id}
                value={t.id}
              >
                {t.name}
              </option>
            ))}
          </select>
          {parentLinkTreeId && (
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return
                family.linkParentAcrossTrees(
                  person.id,
                  parentLinkTreeId,
                  e.target.value,
                )
                setParentLinkTreeId("")
              }}
              className={inputCls}
            >
              <option value="">
                {linkCandidates.length > 0 || linkCoupleCandidates.length > 0
                  ? "Who is the parent in that tree?"
                  : "No one available in that tree"}
              </option>
              {linkCoupleCandidates.length > 0 && (
                <optgroup label="Couples (links both)">
                  {linkCoupleCandidates.map(([a, b]) => (
                    <option
                      key={`${a.id}|${b.id}`}
                      value={a.id}
                    >
                      {a.name} &amp; {b.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Individuals">
                {linkCandidates.map((p) => (
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
        </div>
      )}
    </Section>
  )
}
