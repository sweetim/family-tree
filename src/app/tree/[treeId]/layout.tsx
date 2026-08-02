import type { Metadata } from "next"
import { getPublicTreeName } from "@/server/handlers/trees"

type LayoutProperties = {
  children: React.ReactNode
  params: Promise<{ treeId: string }>
}

export async function generateMetadata({
  params,
}: LayoutProperties): Promise<Metadata> {
  const { treeId } = await params
  const treeName = await getPublicTreeName(treeId)

  if (!treeName) {
    return { robots: { index: false, follow: false } }
  }

  const title = `${treeName} | FamiKi`
  const description = `View the ${treeName} family tree on FamiKi.`

  return {
    title: treeName,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: { title, description, images: ["/og.png"] },
  }
}

export default function TreeLayout({ children }: LayoutProperties) {
  return children
}
