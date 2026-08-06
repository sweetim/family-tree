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
      <Image
        src="/logo.webp"
        alt=""
        width={32}
        height={32}
      />
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
      <path
        fill="currentColor"
        stroke="none"
        d="M16 25.5S7 20.3 7 13.9c0-2.8 2.1-4.9 4.8-4.9 1.7 0 3.3.9 4.2 2.3.9-1.4 2.5-2.3 4.2-2.3 2.7 0 4.8 2.1 4.8 4.9 0 6.4-9 11.6-9 11.6Z"
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
              alt="FamiKi"
              width={44}
              height={44}
              priority
              className="h-9 w-9 object-cover sm:h-10 sm:w-10"
            />
            <span className="landing-wordmark text-xl font-bold tracking-[-0.04em] text-[#173860]">
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

          <div className="relative z-20 grid min-h-dvh grid-rows-[1fr_auto] px-6 pb-3 pt-24 sm:px-8 sm:pb-6 sm:pt-28 lg:h-dvh lg:min-h-0 lg:px-7 lg:pb-6 lg:pt-0">
            <div className="flex items-start pt-14 sm:pt-16 lg:pt-[31vh]">
              <div className="landing-intro max-w-[50rem]">
                <p className="landing-eyebrow mb-4">A private family record</p>
                <h1 className="landing-wordmark text-[clamp(2.3rem,9.5vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.07em] text-[#10213f] lg:text-[clamp(3.75rem,4.8vw,5.5rem)] lg:leading-[0.9]">
                  <span className="block whitespace-nowrap">
                    Your <span className="text-[#4e7fe8]">Family.</span>
                  </span>
                  <span className="block whitespace-nowrap">
                    Your <span className="text-[#4e7fe8]">History.</span>
                  </span>
                  <span className="block whitespace-nowrap">
                    Their <span className="text-[#4e7fe8]">Tomorrow.</span>
                  </span>
                </h1>

                <p className="mt-7 max-w-xl text-[0.96rem] font-medium leading-7 text-[#294b75] sm:text-base lg:text-[1.15rem] lg:leading-8">
                  Build your family tree, preserve the stories and photos behind
                  every branch, and pass your legacy on to the people you love.
                </p>

                <div className="mt-7">
                  <GoogleSignInButton
                    label="Continue with Google"
                    className="landing-google-button px-6 text-sm shadow-[0_8px_20px_rgb(23_56_96/0.16)]"
                  />
                </div>
              </div>
            </div>

            <ul className="landing-feature-list grid w-full max-w-none sm:grid-cols-3 lg:max-w-[65rem]">
              {productFeatures.map((feature) => (
                <li
                  key={feature.title}
                  data-feature-kind={feature.kind}
                  className="landing-feature-item flex gap-4 px-6 py-5 sm:flex-col sm:items-center sm:gap-3 sm:px-8 sm:py-7 sm:text-center lg:px-10"
                >
                  <div className="landing-feature-illustration mt-0.5 h-11 w-11 shrink-0 sm:mt-0 sm:h-14 sm:w-14">
                    <FeatureIllustration kind={feature.kind} />
                  </div>
                  <div>
                    <h2 className="text-[0.98rem] font-bold leading-tight tracking-[-0.035em] text-[#f8faff] sm:text-base">
                      {feature.title}
                    </h2>
                    <p className="mt-1.5 max-w-[15rem] text-[0.8rem] font-medium leading-5 text-[#c6d2e4] sm:text-[0.85rem]">
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
