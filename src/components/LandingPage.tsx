import Image from "next/image"
import { GoogleSignInButton } from "./GoogleSignInButton"

type FeatureKind = "tree" | "memory" | "family"

const productFeatures = [
  {
    title: "Build Your Tree",
    description: "Map your family history beautifully.",
    kind: "tree" as const,
  },
  {
    title: "Save Your Memories",
    description: "Add photos, stories, and special moments.",
    kind: "memory" as const,
  },
  {
    title: "Inspire Generations",
    description: "Pass down your legacy and inspire the future.",
    kind: "family" as const,
  },
]

function FeatureIllustration({ kind }: { kind: FeatureKind }) {
  if (kind === "tree") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        fill="none"
      >
        <circle
          cx="16"
          cy="5"
          r="2.5"
        />
        <circle
          cx="7"
          cy="26"
          r="2.5"
        />
        <circle
          cx="16"
          cy="26"
          r="2.5"
        />
        <circle
          cx="25"
          cy="26"
          r="2.5"
        />
        <path d="M16 7.5v7M7 23.5v-4h18v4M16 14.5v5" />
      </svg>
    )
  }

  if (kind === "memory") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        fill="none"
      >
        <path d="M5 7h16l6 6v12H5z" />
        <path d="M21 7v6h6M8 24l5-5 4 4 3-3 4 4M11 13h.01" />
      </svg>
    )
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      fill="none"
    >
      <rect
        x="4"
        y="4"
        width="24"
        height="24"
        rx="4"
      />
      <path d="m16 9 7 7-7 7-7-7zM16 9V6M23 16h3M16 23v3M9 16H6" />
      <circle
        cx="16"
        cy="9"
        r="1.5"
      />
      <circle
        cx="23"
        cy="16"
        r="1.5"
      />
      <circle
        cx="16"
        cy="23"
        r="1.5"
      />
      <circle
        cx="9"
        cy="16"
        r="1.5"
      />
    </svg>
  )
}

export function LandingPage() {
  return (
    <div className="landing-page min-h-dvh overflow-x-hidden bg-[#f5efe5] text-[#213042] lg:h-dvh lg:overflow-hidden">
      <header className="absolute inset-x-0 top-0 z-40">
        <nav className="flex h-20 items-center px-6 sm:px-8 lg:h-24 lg:px-7">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.webp"
              alt=""
              width={44}
              height={44}
              priority
              className="h-9 w-9 object-cover sm:h-10 sm:w-10"
            />
            <span className="landing-display text-xl font-bold tracking-[-0.04em] text-[#173860]">
              FamiKi
            </span>
          </div>
        </nav>
      </header>

      <main>
        <section className="landing-hero relative isolate min-h-dvh overflow-hidden lg:h-dvh lg:min-h-0">
          <div className="absolute inset-0">
            <Image
              src="/landing-page.webp"
              alt="A multigenerational family gathered beneath cherry blossoms"
              fill
              priority
              sizes="100vw"
              className="landing-photo object-cover object-[64%_center] lg:object-[62%_center]"
            />
          </div>

          <div className="relative z-20 grid min-h-dvh grid-rows-[1fr_auto] px-6 pb-3 pt-24 sm:px-8 sm:pb-6 sm:pt-28 lg:h-dvh lg:min-h-0 lg:px-7 lg:pb-4 lg:pt-24">
            <div className="flex items-start pt-14 sm:pt-16 lg:pt-16">
              <div className="landing-intro max-w-[31rem]">
                <h1 className="landing-display text-[clamp(3rem,11vw,5.25rem)] leading-[0.94] tracking-[-0.045em] text-[#173860] lg:text-[clamp(3.5rem,4.5vw,5.25rem)]">
                  <span className="block">Your Family.</span>
                  <span className="block">Your History.</span>
                  <span className="block">Their Tomorrow.</span>
                </h1>

                <p className="mt-7 max-w-[22rem] text-[0.96rem] font-medium leading-7 text-[#405672] sm:text-base">
                  Create your family tree, save stories and photos, and give
                  future generations a legacy to be proud of.
                </p>

                <div className="mt-7">
                  <GoogleSignInButton
                    label="Continue with Google"
                    className="landing-google-button px-6 text-sm shadow-[0_8px_20px_rgb(23_56_96/0.16)]"
                  />
                </div>
              </div>
            </div>

            <ul className="landing-feature-list grid w-full max-w-none overflow-hidden sm:grid-cols-3">
              {productFeatures.map((feature) => (
                <li
                  key={feature.title}
                  className="landing-feature-item flex gap-5 px-7 py-7 sm:px-8 sm:py-8 lg:px-12"
                >
                  <div className="landing-feature-illustration mt-0.5 h-11 w-11 shrink-0 text-[#315d98] sm:h-12 sm:w-12">
                    <FeatureIllustration kind={feature.kind} />
                  </div>
                  <div>
                    <h2 className="text-[1.02rem] font-bold leading-tight tracking-[-0.035em] text-[#243b5d] sm:text-[1.1rem]">
                      {feature.title}
                    </h2>
                    <p className="mt-1.5 max-w-[15rem] text-[0.82rem] font-medium leading-6 text-[#667789] sm:text-[0.88rem]">
                      {feature.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}
