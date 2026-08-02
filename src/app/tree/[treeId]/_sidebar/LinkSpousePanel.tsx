import { Heart } from "lucide-react"
import { useMemo, useState } from "react"
import { Section } from "@/components/Section"
import { type FamilyStore, type TreeMeta, useMembersOf } from "@/store"
import type { Person } from "@/types"
import { BackToChoose } from "./BackToChoose"
import { selectCls, relFromLink } from "./shared"

export function LinkSpousePanel({
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
  const currentCandidates = Object.values(family.people).filter(
    (candidate) =>
      candidate.id !== person.id && !person.spouseIds.includes(candidate.id),
  )
  const otherTrees = allTrees.filter((tree) => tree.id !== treeId)
  const otherTreeMembers = useMembersOf(linkTreeId || undefined)
  const otherTreeCandidates = useMemo(
    () =>
      otherTreeMembers.filter(
        (candidate) =>
          candidate.id !== person.id
          && !person.spouseIds.includes(candidate.id),
      ),
    [otherTreeMembers, person.id, person.spouseIds],
  )

  return (
    <div className="animate-slide-up space-y-4">
      <div>
        <div>
          <BackToChoose
            kind="spouse"
            sourceId={person.id}
            rel={relFromLink("spouse", person.id)}
          />
          <h2 className="text-base font-semibold text-slate-800">
            Connect spouse
          </h2>
          <p className="text-xs text-slate-500">
            Link a spouse for {person.name}
          </p>
        </div>
      </div>

      <Section
        title="This family"
        icon={Heart}
      >
        <select
          value=""
          onChange={(event) => {
            if (!event.target.value) return
            family.linkSpouse(person.id, event.target.value)
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
          icon={Heart}
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
                  family.linkAcrossTrees(
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
                    ? "Choose a spouse..."
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
