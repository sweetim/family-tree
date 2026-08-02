import type { MetadataRoute } from "next"

const siteUrl = process.env.BETTER_AUTH_URL

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/sharing", "/signed-out", "/tree/"],
    },
    ...(siteUrl ? { sitemap: new URL("/sitemap.xml", siteUrl).toString() } : {}),
  }
}
