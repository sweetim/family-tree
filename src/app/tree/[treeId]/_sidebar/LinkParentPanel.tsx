import type { FamilyStore, TreeMeta } from "@/store"
import type { Person } from "@/types"
import { BackToChoose } from "./BackToChoose"
import { ParentsSection } from "./ParentsSection"
import { relFromLink } from "./shared"

export function LinkParentPanel({
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
  return (
    <div className="animate-slide-up space-y-4">
      <div>
        <div>
          <BackToChoose
            kind="parent"
            sourceId={person.id}
            rel={relFromLink("parent", person.id)}
          />
          <h2 className="text-base font-semibold text-slate-800">
            Connect parents
          </h2>
          <p className="text-xs text-slate-500">
            Link parents for {person.name}
          </p>
        </div>
      </div>
      <ParentsSection
        family={family}
        treeId={treeId}
        allTrees={allTrees}
        person={person}
        onSelect={onSelect}
      />
    </div>
  )
}
