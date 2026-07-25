# Client Store and Sync

`src/store.ts` is a hand-rolled external store connected to React with
`useSyncExternalStore`. State and pending changes are in memory only.

## Normalized state

`GlobalState` contains:

- `persons`: shared identity records keyed by person id.
- `index`: tree metadata (`TreeMeta`) including owner/share metadata.
- `treeMembers`: memberships keyed by `(treeId, personId)`.
- `unions`: canonical shared unions keyed by id.
- `unionEvents`: shared history records keyed by id.
- `treeUnions`: tree associations keyed by `(treeId, unionId)`.
- `parentChildRelationships`: shared parent facts keyed by id.
- `treeParentChildRelationships`: tree associations keyed by
  `(treeId, parentChildRelationshipId)`.

`projectTree` derives `FamilyData` for the layout and sidebar from these maps.

## Local mutations

Most mutations use `update` optimistically. `stampAndEnqueue` compares record
references, stamps each changed record with a new client `updatedAt`, and puts
its id in a per-collection dirty map. The exact dirty/sync collections are:

1. `persons`
2. `trees`
3. `treeMembers`
4. `unions`
5. `unionEvents`
6. `treeUnions`
7. `parentChildRelationships`
8. `treeParentChildRelationships`

Each dirty entry has an action and monotonically increasing local revision.
Acknowledging an older push cannot clear a newer edit to the same record.
Deletes serialize as tombstones; association tombstones carry their composite
key fields.

Pushes are serialized. Only one `POST /api/sync` is in flight for a store
generation, and the loop sends newer dirty revisions after the current request
returns. Failed records remain dirty in memory. Successful applied and skipped
revisions are cleared; any skipped record schedules an authoritative epoch pull
after newer pending edits have been pushed.

Tree deletion is server-authoritative instead: the client awaits
`DELETE /api/trees/[treeId]`, then removes the confirmed tree and its local
associations. A failed request leaves the tree visible.

## Shared facts and local detach

- Person identity edits are global.
- Marriage-date edits change the shared `married` event and appear in every
  associated tree.
- Adoption toggles change the shared parent/child type and appear in every
  associated tree.
- Spouse unlink, parent removal, and remove-from-tree delete only associations
  for the selected tree.
- Person deletion is global. The client removes its local memberships and tree
  associations; the server owner-authorized cascade tombstones all canonical
  facts and associations involving the person.
- Adding a spouse associates the shared union with writable trees containing
  both people. A newly added spouse is also added to writable trees containing
  their partner.
- Adding a child propagates to writable trees containing all selected parents.

The Core UI creates a `married` event and edits its date. Although the model
supports divorce and other history events, unlinking in Core is a tree-local
detach rather than a divorce event.

## Remote merge and reconciliation

`applyRemote` merges every normalized record independently by `updatedAt` and
does not enqueue it again. Newer local records win; newer remote tombstones
remove local records.

An in-memory remote tombstone clock is kept per id in every collection. It
blocks a delayed older or equal active record from resurrecting deleted data.
Tree tombstones also remove and clock their local associations.

`applyFullPull` is authoritative: it rebuilds all maps from an epoch pull,
clears dirty queues, and records the pull's `serverTime` as a tombstone clock
for anything formerly local but now absent. This removes revoked shared trees
and stale optimistic records.

The store performs a full reconciliation:

- whenever the authenticated account changes, after resetting all state and
  tombstone clocks;
- after a push reports any skipped record.

There is no polling, websocket, or background refresh. Normal operation is a
full pull on account bootstrap followed by serialized pushes on mutation.

## Pull shape

Owned data can be returned as timestamp deltas with active dependencies needed
to project each owned tree. Every shared tree is instead an authoritative
active snapshot on every pull: active tree metadata, people, memberships,
unions, events, and parent associations only. Former shared dependencies and
tombstones are omitted; full reconciliation removes anything absent.

## Store operations

`useTreeIndex` creates, renames, and deletes trees. `useFamily(treeId)` returns
projected people, `readOnly` for viewers, and person/relationship mutations.
Important behavior:

- `updatePerson` edits shared identity.
- `unlinkSpouse`, `removeParent`, and `removeFromTree` detach one tree.
- `updateSpouseDate` and `setParentAdopted` edit shared facts.
- `addParent` refuses self-links, a third global parent, and ancestry cycles.
- `mergePersons` creates replacement facts for writable associations rather
  than mutating immutable union or parent endpoints.
- `replaceAll` reconciles imported projected `FamilyData` into normalized maps.

Legacy projected JSON import remains supported at the import boundary; it is
converted to normalized records before sync. View preferences in
`src/lib/view-settings.ts` remain client-only in `localStorage`.
