/**
 * One attempt of the signed-in session's first server sync, extracted from the
 * React bootstrap effect so the call ordering is unit testable. The critical
 * invariant — flushing pending mutations via `synchronize` BEFORE reading a tree
 * snapshot — prevents a just-created tree from 404-ing because its create
 * mutation has not landed on the server yet. Backoff/retry and 404 handling stay
 * in the component; this function performs a single attempt and lets errors
 * propagate so the caller can decide whether to retry.
 */
export async function bootstrapTreeSync<Manifest, Snapshot>(args: {
  treeId: string | undefined
  restore: () => Promise<void>
  synchronize: () => Promise<void>
  fetchManifest: () => Promise<Manifest>
  applyManifest: (manifest: Manifest) => void
  fetchSnapshot: (treeId: string) => Promise<Snapshot>
  applySnapshot: (snapshot: Snapshot) => void
  markHydrated: () => void
  isCancelled?: () => boolean
}): Promise<void> {
  const isCancelled = args.isCancelled ?? (() => false)
  await args.restore()
  await args.synchronize()
  const manifest = await args.fetchManifest()
  if (isCancelled()) return
  args.applyManifest(manifest)
  if (args.treeId) {
    // Always fetch the full snapshot: the tree view waits for this before
    // painting, so the first frame is the authoritative state rather than a
    // radius-3 partial that later expands.
    const snapshot = await args.fetchSnapshot(args.treeId)
    if (isCancelled()) return
    args.applySnapshot(snapshot)
  }
  args.markHydrated()
}
