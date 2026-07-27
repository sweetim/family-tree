"use client"

import { useEffect, useRef, useState } from "react"

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
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // Keep the latest onError without adding it to the effect deps (avoids
  // re-running the reset effect on every parent render).
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    // For an instantly-decodable image (inline data URL or a cached response),
    // the browser fires load/error before this post-paint effect runs, so the
    // <img> handlers below never fire. Recover by inspecting the final state.
    const img = imgRef.current
    if (!img?.complete) return
    if (img.naturalWidth > 0) {
      setLoaded(true)
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
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true)
          onError?.()
        }}
        className={`h-full w-full rounded-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  )
}
