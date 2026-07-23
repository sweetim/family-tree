import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

const title = "Family Tree"
const description =
  "An interactive family tree builder. Register family members and see them laid out automatically as a tree."
const siteUrl = process.env.BETTER_AUTH_URL

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    siteName: title,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={inter.variable}
    >
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
