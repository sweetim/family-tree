import type { MetadataRoute } from "next"

const siteUrl = process.env.BETTER_AUTH_URL

export default function sitemap(): MetadataRoute.Sitemap {
  if (!siteUrl) return []

  return [
    {
      url: new URL("/", siteUrl).toString(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ]
}
