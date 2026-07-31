"use client"

import { useEffect, useRef, useState } from "react"

// React Flow's onlyRenderVisibleElements unmounts cards that scroll out of
// view, so a card returning to view would otherwise reload its avatar (and
// flicker) even though the browser cache holds the bytes. Remembering which
// srcs have already loaded lets a remounted avatar render at full opacity
// immediately. The set is per-page-session and bounded by the people viewed.
const loadedSrcs = new Set<string>()

export function PersonAvatar({
  src,
  alt,
  className,
  onError,
}: {
  src: string
  alt: string
  className: string
  onError?: () => void
}) {
  const [loaded, setLoaded] = useState(() => loadedSrcs.has(src))
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // Keep the latest onError without adding it to the effect deps (avoids
  // re-running the reset effect on every parent render).
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    // Already loaded earlier this session: skip the loading pulse so a
    // remounted avatar doesn't flicker. The recreated <img> still fires onLoad
    // (from the browser cache) to re-confirm.
    if (loadedSrcs.has(src)) {
      setLoaded(true)
      setFailed(false)
      return
    }
    setLoaded(false)
    setFailed(false)
    // For an instantly-decodable image (inline data URL or a cached response),
    // the browser fires load/error before this post-paint effect runs, so the
    // <img> handlers below never fire. Recover by inspecting the final state.
    const img = imgRef.current
    if (!img?.complete) return
    if (img.naturalWidth > 0) {
      setLoaded(true)
      loadedSrcs.add(src)
    } else {
      setFailed(true)
      onErrorRef.current?.()
    }
  }, [src])

  return (
    <div className={`relative rounded-full ${className}`}>
      {!loaded && !failed && (
        <div className="absolute inset-0 animate-pulse rounded-full bg-slate-200" />
      )}
      {/* biome-ignore lint/performance/noImgElement: small avatar streamed via the auth-checked proxy; Next/Image offers no benefit */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => {
          setLoaded(true)
          loadedSrcs.add(src)
        }}
        onError={() => {
          setFailed(true)
          onError?.()
        }}
        className={`h-full w-full rounded-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  )
}
