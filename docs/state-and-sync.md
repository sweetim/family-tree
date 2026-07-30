# Client Store and Sync

`src/store/` contains a normalized external store connected to React with
`useSyncExternalStore`. Rendering remains optimistic, while PostgreSQL is the
durable authority.

## State

`GlobalState` contains people, tree metadata, memberships, unions and events,
tree-union associations, parent facts, and tree-parent associations.
`projectTree` derives the UI-facing `FamilyData` shape.

Every server record has an integer `revision`. Local edits retain the last
server revision as their concurrency base; browser wall-clock time is not used
for conflict resolution.

## Bootstrap and lazy reads

Account bootstrap restores the account's IndexedDB snapshot, then fetches the
paginated `/api/trees` manifest. The home page therefore loads only metadata
and counts. Opening a main tree fetches that tree's snapshot. A person deep link
fetches a bounded radius-three graph, and cross-tree member selectors load the
selected tree on demand.

People search is server-side and bounded, so search does not require all family
graphs in memory.

## Durable outbox

Optimistic state, dirty records, base revisions, stable device ID, mutation
retry IDs, and local revision counters are stored per account in IndexedDB.
Reload, browser restart, network failure, or an interrupted response therefore
does not discard pending intent.

Pushes are serialized. A stable mutation ID is persisted before the request.
Retries use the same ID and receive `alreadyApplied` when the first response was
lost after commit. Network failures remain pending and retry on a 15-second
timer, browser focus, and the `online` event.

IndexedDB writes merge dirty records transactionally across tabs. If two tabs
edit the same record offline, both values are retained and the account menu
offers explicit `Keep current` and `Use other edit` resolution instead of
choosing one silently.

## Atomic mutations and conflicts

`POST /api/mutations` sends a bounded normalized record set as one logical
mutation. Server ACL checks, dependency checks, canonical ID adoption, graph
constraints, writes, scope-version increments, change-log insertion, and the
idempotency receipt share one transaction.

Successful acknowledgements advance local server revisions without clearing a
newer local edit. A conflict rolls back the complete mutation. Conflicting
records remain in the durable outbox, remain visible over the refreshed server
base, and are marked blocked rather than silently discarded. A subsequent user
edit rebases that intent on the current server revision.

The account menu displays `saved`, `saving`, `offline`, or `conflict` state.
When blocked server mutations affect the open tree, its sidebar shows a
**Review changes** panel grouped by logical user operation. Immutable device and
server snapshots are persisted for comparison. **Keep my change** rebases the
whole operation, while **Use server version** discards only unchanged records
from that operation, preserving edits made after the conflict.

## Incremental synchronization

Each loaded tree stores an opaque cursor. Polling, focus, and online refreshes
request `/api/changes` and merge only committed batches after that cursor.
Change rows include authoritative revisions and tombstones. Cursor pages are
bounded to 100 batches.

If history has expired, the server returns `410 resetRequired` and the client
reloads only that tree. If access was revoked, it refreshes the manifest and
removes the inaccessible tree. Shared-tree changes no longer force complete
snapshots of every shared tree.

## Deletion and aliases

Tree deletion uses the same mutation service as other edits. It atomically
tombstones tree-local records and removes shares. Person-owner deletion
atomically tombstones the person and every dependent fact and association.

Parent relationship collisions return canonical fact and association aliases.
The store remaps records, keys, revisions, and queued work immediately, avoiding
the former remove/re-add/remove identity mismatch.

## Photos

Stored photos remain represented by a marker in client state. Pulls expose only
`hasPhoto`. New Blob uploads are tracked during mutation execution: rollback
deletes newly uploaded blobs, while replaced blobs are deleted only after the
database transaction commits.
