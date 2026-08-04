import Image from "next/image"
import { GoogleSignInButton } from "./GoogleSignInButton"

type FeatureKind = "tree" | "memory" | "family"

const productFeatures = [
  {
    label: "01 / Family tree",
    title: "Build the tree",
    description:
      "Parents, partners, and children arrange into a clear family picture.",
    kind: "tree" as const,
  },
  {
    label: "02 / Family memories",
    title: "Keep the memories",
    description: "Add photos, dates, and places that turn names into stories.",
    kind: "memory" as const,
  },
  {
    label: "03 / Shared record",
    title: "Share with family",
    description:
      "Share privately with relatives who can view or help preserve it.",
    kind: "family" as const,
  },
]

function FeatureIllustration({ kind }: { kind: FeatureKind }) {
  if (kind === "tree") {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="5" r="2.5" />
        <circle cx="7" cy="26" r="2.5" />
        <circle cx="16" cy="26" r="2.5" />
        <circle cx="25" cy="26" r="2.5" />
        <path d="M16 7.5v7M7 23.5v-4h18v4M16 14.5v5" />
      </svg>
    )
  }

  if (kind === "memory") {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
        <path d="M5 7h16l6 6v12H5z" />
        <path d="M21 7v6h6M8 24l5-5 4 4 3-3 4 4M11 13h.01" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
      <path d="M4 7.5c4.5-1.5 8.5-.5 12 2.5v15c-3.5-3-7.5-4-12-2.5zM28 7.5c-4.5-1.5-8.5-.5-12 2.5v15c3.5-3 7.5-4 12-2.5z" />
      <circle cx="12" cy="14" r="2" />
      <circle cx="20" cy="14" r="2" />
      <path d="M8.5 20c1-2 2.2-3 3.5-3s2.5 1 3.5 3M16.5 20c1-2 2.2-3 3.5-3s2.5 1 3.5 3" />
    </svg>
  )
}

export function LandingPage() {
  return (
    <div className="landing-page min-h-dvh overflow-x-hidden bg-[#101d46] text-white lg:h-dvh lg:overflow-hidden">
      <header className="absolute inset-x-0 top-0 z-40">
        <nav className="flex h-20 items-center px-5 sm:px-8 lg:px-12">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.webp"
              alt=""
              width={44}
              height={44}
              priority
              className="h-9 w-9 object-cover sm:h-10 sm:w-10"
            />
            <span className="landing-display text-xl font-bold tracking-[-0.04em] text-white">
              FamiKi
            </span>
          </div>
        </nav>
      </header>

      <main>
        <section className="landing-hero relative isolate min-h-dvh overflow-hidden lg:h-dvh lg:min-h-0">
          <div className="absolute inset-0">
            <Image
              src="/landing-family-archive.webp"
              alt="Several generations arranging family photographs into a tree with cobalt thread"
              fill
              priority
              sizes="100vw"
              className="landing-photo object-cover object-[center_44%]"
            />
            <div className="landing-scrim absolute inset-0" />
            <div className="landing-grain absolute inset-0" />
          </div>

          <div className="relative z-20 grid min-h-dvh grid-rows-[1fr_auto] px-5 pb-5 pt-28 sm:px-8 sm:pb-8 sm:pt-32 lg:h-dvh lg:min-h-0 lg:px-12 lg:pb-10 lg:pt-28">
            <div className="flex items-center">
              <div className="max-w-[43rem] pb-8 lg:pb-4">
                <p className="landing-utility mb-6 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-cobalt-200 sm:mb-8 sm:text-[11px]">
                  <span className="h-px w-8 bg-cobalt-400" />
                  A private home for family history
                </p>

                <h1 className="landing-display text-[clamp(2.4rem,12vw,5rem)] font-bold leading-[0.88] tracking-[-0.06em] text-white lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <span className="block">The stories that</span>
                  <span className="block">
                    made you, <span className="text-cobalt-300">together.</span>
                  </span>
                </h1>

                <p className="mt-8 max-w-[34rem] text-base leading-7 text-slate-300 sm:mt-10 sm:text-lg sm:leading-8">
                  Build your family tree, keep the details close, and invite the
                  people who remember them.
                </p>

                <div className="mt-8 sm:mt-10">
                  <GoogleSignInButton
                    variant="landing"
                    size="lg"
                    label="Continue with Google"
                    className="focus-visible:ring-cobalt-300 focus-visible:ring-offset-[#101d46]"
                  />
                </div>

              </div>
            </div>

            <ul className="grid w-full max-w-[72rem] gap-2 sm:grid-cols-3 sm:gap-3">
              {productFeatures.map((feature) => (
                <li
                  key={feature.label}
                  className="landing-feature-card border border-[#f4efe4]/30 bg-[#171d38]/70 px-4 py-3 backdrop-blur-md sm:px-5 sm:py-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="landing-utility text-[9px] font-semibold uppercase tracking-[0.15em] text-[#f4efe4]/70">
                      {feature.label}
                    </p>
                    <div className="landing-feature-illustration h-8 w-8 shrink-0 text-[#f4efe4]">
                      <FeatureIllustration kind={feature.kind} />
                    </div>
                  </div>
                  <h2 className="landing-display mt-2 text-lg font-bold tracking-[-0.035em] text-[#f4efe4] sm:text-xl">
                    {feature.title}
                  </h2>
                  <p className="mt-1.5 max-w-[19rem] text-xs leading-5 text-[#e8dfcf] sm:text-sm">
                    {feature.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
