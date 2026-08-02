import { Baby } from "lucide-react"
import { useMemo, useState } from "react"
import { Section } from "@/components/Section"
import { type FamilyStore, type TreeMeta, useTreePeople } from "@/store"
import { ancestorsOf, type Person } from "@/types"
import { BackToChoose } from "./BackToChoose"
import { selectCls, relFromLink } from "./shared"

export function LinkChildPanel({
  family,
  treeId,
  allTrees,
  person,
  onClose,
}: {
  family: FamilyStore
  treeId: string
  allTrees: TreeMeta[]
  person: Person
  onClose: () => void
}) {
  const [linkTreeId, setLinkTreeId] = useState("")
  const ancestors = ancestorsOf(family.people, person.id)
  const currentCandidates = Object.values(family.people).filter(
    (candidate) =>
      candidate.id !== person.id
      && candidate.parents.length < 2
      && !candidate.parents.some((parent) => parent.id === person.id)
      && !ancestors.has(candidate.id),
  )
  const otherTrees = allTrees.filter((tree) => tree.id !== treeId)
  const otherTreePeople = useTreePeople(linkTreeId || undefined)
  const otherTreeCandidates = useMemo(
    () =>
      otherTreePeople.filter(
        (candidate) =>
          candidate.id !== person.id
          && candidate.parents.length < 2
          && !candidate.parents.some((parent) => parent.id === person.id),
      ),
    [otherTreePeople, person.id],
  )

  return (
    <div className="animate-slide-up space-y-4">
      <div>
        <div>
          <BackToChoose
            kind="child"
            sourceId={person.id}
            rel={relFromLink("child", person.id)}
          />
          <h2 className="text-base font-semibold text-slate-800">
            Connect child
          </h2>
          <p className="text-xs text-slate-500">
            Link a child for {person.name}
          </p>
        </div>
      </div>

      <Section
        title="This family"
        icon={Baby}
      >
        <select
          value=""
          onChange={(event) => {
            if (!event.target.value) return
            family.addParent(event.target.value, person.id)
            onClose()
          }}
          className={selectCls}
        >
          <option value="">
            {currentCandidates.length > 0
              ? "+ Connect person in this family..."
              : "No one available in this family"}
          </option>
          {currentCandidates.map((candidate) => (
            <option
              key={candidate.id}
              value={candidate.id}
            >
              {candidate.name}
            </option>
          ))}
        </select>
      </Section>

      {otherTrees.length > 0 && (
        <Section
          title="Another family"
          icon={Baby}
        >
          <div className="space-y-2">
            <select
              value={linkTreeId}
              onChange={(event) => setLinkTreeId(event.target.value)}
              className={selectCls}
            >
              <option value="">Choose a family...</option>
              {otherTrees.map((tree) => (
                <option
                  key={tree.id}
                  value={tree.id}
                >
                  {tree.name}
                </option>
              ))}
            </select>
            {linkTreeId && (
              <select
                value=""
                onChange={(event) => {
                  if (!event.target.value) return
                  family.linkChildAcrossTrees(
                    person.id,
                    linkTreeId,
                    event.target.value,
                  )
                  onClose()
                }}
                className={selectCls}
              >
                <option value="">
                  {otherTreeCandidates.length > 0
                    ? "Choose a child..."
                    : "No one available in that family"}
                </option>
                {otherTreeCandidates.map((candidate) => (
                  <option
                    key={candidate.id}
                    value={candidate.id}
                  >
                    {candidate.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
