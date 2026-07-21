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
 * downscale it to a small JPEG data URL so it fits comfortably in
 * localStorage. Output is square; the existing rounded-full displays mask
 * it into a circle.
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
