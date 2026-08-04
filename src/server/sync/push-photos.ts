import type { SyncPushRequest } from "../../sync/types"
import { deletePhoto, isPhotoDataUrl, normalizePhoto } from "../blob"
import type { SessionUser } from "../session"

export type PhotoLifecycle = {
  uploadedPhotos: Set<string>
  photosToDeleteAfterCommit: Set<string>
  consumedPhotos: Set<string>
  preuploadedPhotos: Map<string, { url: string } | { error: true }>
}

export async function preuploadMutationPhotos(
  me: SessionUser,
  body: SyncPushRequest,
): Promise<PhotoLifecycle> {
  const photoLifecycle: PhotoLifecycle = {
    uploadedPhotos: new Set(),
    photosToDeleteAfterCommit: new Set(),
    consumedPhotos: new Set(),
    preuploadedPhotos: new Map(),
  }
  for (const wire of body.persons) {
    if ("deletedAt" in wire) continue
    const value = wire.photo
    if (
      value === null
      || value === undefined
      || !isPhotoDataUrl(value)
      || photoLifecycle.preuploadedPhotos.has(value)
    ) {
      continue
    }
    try {
      const url = await normalizePhoto(me.id, value)
      if (!url) throw new Error("photo upload returned no url")
      photoLifecycle.preuploadedPhotos.set(value, { url })
      photoLifecycle.uploadedPhotos.add(url)
    } catch {
      photoLifecycle.preuploadedPhotos.set(value, { error: true })
    }
  }
  return photoLifecycle
}

export function resolvePreuploadedPhoto(
  photoLifecycle: PhotoLifecycle,
  value: string | null | undefined,
): string | null {
  if (!value) return null
  if (!isPhotoDataUrl(value)) return value
  const result = photoLifecycle.preuploadedPhotos.get(value)
  if (!result || "error" in result) throw new Error("photo upload failed")
  return result.url
}

export function resolvePreuploadedPhotoUpdate(
  photoLifecycle: PhotoLifecycle,
  existingPhoto: string | null,
  value: string | null | undefined,
): string | null {
  return value === undefined
    ? existingPhoto
    : resolvePreuploadedPhoto(photoLifecycle, value)
}

export async function finalizeCommittedPhotos(
  photoLifecycle: PhotoLifecycle,
): Promise<void> {
  await Promise.all(
    [...photoLifecycle.photosToDeleteAfterCommit].map(deletePhoto),
  )
  // Delete staged photos not used by a committed row, including uploads made for
  // skipped records or an already-applied mutation.
  await Promise.all(
    [...photoLifecycle.uploadedPhotos]
      .filter((url) => !photoLifecycle.consumedPhotos.has(url))
      .map(deletePhoto),
  )
}

export async function discardStagedPhotos(
  photoLifecycle: PhotoLifecycle,
): Promise<void> {
  await Promise.all([...photoLifecycle.uploadedPhotos].map(deletePhoto))
}
