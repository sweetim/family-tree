const MAX_SIZE = 256

/**
 * Read an uploaded/pasted image File into a data URL for previewing and
 * loading into an <img> for cropping.
 */
export function fileToImageSrc(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read image"))
    reader.readAsDataURL(file)
  })
}

/**
 * Crop a square region (in natural image coordinates) out of an image and
 * downscale it to a small JPEG data URL. The data URL is short-lived: it is
 * uploaded to Vercel Blob on sync, and only the resulting blob URL is stored.
 * Output is square; the existing rounded-full displays mask it into a circle.
 */
export function cropToAvatar(
  img: HTMLImageElement,
  sourceX: number,
  sourceY: number,
  sourceSize: number,
): string {
  const canvas = document.createElement("canvas")
  canvas.width = MAX_SIZE
  canvas.height = MAX_SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D not supported")
  ctx.drawImage(
    img,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    MAX_SIZE,
    MAX_SIZE,
  )
  return canvas.toDataURL("image/jpeg", 0.82)
}

/**
 * Source URL for rendering a person's avatar through the auth-checked server
 * proxy (`/api/person-photo/[personId]`). The stored blob URL is never used
 * directly in the browser. `updatedAt` is appended as a cache-buster so a
 * changed photo is fetched even though the path stays stable.
 */
export function photoProxyUrl(personId: string, updatedAt?: string): string {
  const query = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ""
  return `/api/person-photo/${personId}${query}`
}

/**
 * Resolve the avatar source for a person. A freshly cropped photo lives as an
 * inline data URL in client state and has not reached the server yet, so it is
 * rendered directly; a stored photo is served through the auth-checked proxy.
 * Returns `undefined` when the person has no photo (caller renders initials).
 */
export function personPhotoSrc(person: {
  id: string
  photo?: string
  updatedAt?: string
}): string | undefined {
  if (!person.photo) return undefined
  return person.photo.startsWith("data:")
    ? person.photo
    : photoProxyUrl(person.id, person.updatedAt)
}
