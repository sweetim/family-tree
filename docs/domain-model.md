# Domain Model

Family data is split into canonical shared facts and tree-local associations.
The domain types and projection functions live in `src/types.ts`.

## Canonical shared facts

- `PersonIdentity` stores one person's name, birth/death dates, gender,
  location, photo, owner, and sync timestamp. A photo is compressed in the
  browser, then synced and stored as text.
- `Union` stores an immutable canonical pair of people. A pair is ordered by
  person id and may have many `UnionEvent` history records.
- `UnionEvent` stores a typed event and optional ISO calendar date. Terminal
  events are `divorced`, `annulled`, and `relationship_ended`.
- `ParentChildRelationship` stores immutable parent and child endpoints plus a
  relationship type.

These facts can be associated with multiple trees. Identity edits, marriage
date edits, and biological/adoptive changes update the shared record and
therefore propagate to every associated tree.

Union history can represent starts, engagement, marriage, civil union,
domestic partnership, separation, reconciliation, divorce, annulment, and an
ended relationship. The Core UI currently exposes marriage and marriage-date
editing only. Removing a spouse link does not record a divorce event.

## Tree-local associations

- `TreeMember` associates a person with one tree.
- `TreeUnion` associates a shared union with one tree.
- `TreeParentChildRelationship` associates a shared parent/child fact with one
  tree.

Unlinking a spouse or parent removes only the selected tree association.
Removing a person from a tree also removes that tree's relationship
associations involving the person. Shared facts and associations in other
trees remain intact.

Cross-tree linking reuses person and relationship ids; it does not duplicate
identity or create a separate link entity.

## Main types

| Type | Meaning |
|---|---|
| `Gender` | `male`, `female`, or `other`. |
| `UnionEventType` | All supported union history event types. |
| `ParentChildRelationshipType` | `biological`, `adoptive`, `foster`, `guardian`, or `step`. |
| `NormalizedRelationships` | Maps for `treeMembers`, `unions`, `unionEvents`, `treeUnions`, `parentChildRelationships`, and `treeParentChildRelationships`. |
| `ParentLink` | Projected parent reference with `id`, optional `adopted`, and optional full relationship `type`. |
| `Person` | `PersonIdentity` plus projected `parents`, `spouseIds`, and `marriageDates`. |
| `FamilyData` | `Record<string, Person>`, the UI view for one tree. |
| `Relationship` | Placement for a new person: root, child, spouse, or parent. |
| `PersonInput` | Writable identity fields without id or sync metadata. |

## Projection

`projectTree(identities, relationships, treeId)` derives the existing UI shape
from normalized maps:

1. Active memberships select the people in the tree.
2. Associated current unions derive symmetric `spouseIds`.
3. The latest married event supplies `marriageDates`; a latest terminal event
   makes the union non-current.
4. Associated parent/child facts derive each child's `parents`.

Missing identities or endpoints are ignored. Ordering is stable by creation
time and id. `withForeignParents` can additionally include direct parents known
through another accessible tree for the optional expanded view.

Traversal helpers such as `childrenOf`, `descendantsOf`, and `ancestorsOf`
operate on projected `FamilyData`, keeping rendering independent
from persistence.

## Invariants

- A person may be an active member of many trees.
- A union has two distinct, canonically ordered immutable endpoints.
- Both endpoints of a tree union must be active members of that tree.
- A parent/child fact cannot be a self-link, and its endpoints are immutable.
- A child has at most two active parents globally, not two per tree.
- The active global parent graph must be acyclic.
- Both endpoints of a tree parent association must be active members of that
  tree.

Wire types in `src/sync/types.ts` mirror these records and add tombstone and
access metadata. See [state-and-sync.md](./state-and-sync.md) and
[database.md](./database.md).
