"use client"

import { useEffect, useState } from "react"

export function PersonAvatar({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className: string
}) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
  }, [src])

  return (
    <div className={`relative rounded-full ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse rounded-full bg-slate-200" />
      )}
      {/* biome-ignore lint/performance/noImgElement: small avatar streamed via the auth-checked proxy; Next/Image offers no benefit */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={`h-full w-full rounded-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  )
}
