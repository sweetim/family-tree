import type { Metadata } from "next"
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
})
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "600"],
})

const title = "FamiKi | Every branch, in its place"
const description =
  "Build a private family tree that automatically arranges partners, parents, and children as your family fills in the details."
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
      className={`${inter.variable} ${bricolage.variable} ${ibmPlexMono.variable}`}
    >
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
