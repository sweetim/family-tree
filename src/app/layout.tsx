import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

const title = "FamiKi | Your family story, beautifully connected"
const description =
  "Build a private, collaborative family tree that organizes every generation, memory, and relationship beautifully."
const siteUrl = process.env.BETTER_AUTH_URL

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title,
  description,
  icons: { icon: "/logo.webp" },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "FamiKi",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "FamiKi family tree builder",
      },
    ],
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
