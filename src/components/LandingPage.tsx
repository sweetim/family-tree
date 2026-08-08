import Image from "next/image"
import type { CSSProperties } from "react"
import { GoogleSignInButton } from "./GoogleSignInButton"

type SakuraPetal = {
  id: number
  left: number
  size: number
  height: number
  fall: number
  delay: number
  sway: number
  spin: number
  reverse: boolean
  opacity: number
}

// Deterministic petal set (seeded LCG) so server and client markup match and
// no hydration mismatch can occur.
function buildPetals(count: number): SakuraPetal[] {
  let seed = 20240807
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  return Array.from({ length: count }, (_, index) => {
    const size = 10 + rand() * 12
    return {
      id: index,
      left: rand() * 100,
      size,
      height: size * 1.2,
      fall: 9 + rand() * 7,
      // Negative delay starts each petal mid-fall so the field looks populated.
      delay: -(rand() * 14),
      sway: 12 + rand() * 24,
      spin: 4 + rand() * 6,
      reverse: rand() > 0.5,
      opacity: 0.7 + rand() * 0.3,
    }
  })
}

const PETALS = buildPetals(16)

// A single cherry-blossom petal (pointed base, notched tip).
const PETAL_PATH =
  "M10 1 C 16 5 19 14 13 22 C 12 23.5 10 20 10 17.5 C 10 20 8 23.5 7 22 C 1 14 4 5 10 1 Z"

export function LandingPage() {
  return (
    <div className="landing-page min-h-dvh overflow-x-hidden text-[#213042] lg:h-dvh lg:overflow-hidden">
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
        <section className="landing-hero relative isolate min-h-dvh overflow-hidden lg:h-dvh">
          <div
            className="landing-petals"
            aria-hidden="true"
          >
            {PETALS.map((petal) => (
              <span
                key={petal.id}
                className="landing-petal"
                style={
                  {
                    left: `${petal.left}%`,
                    width: `${petal.size}px`,
                    height: `${petal.height}px`,
                    animationDuration: `${petal.fall}s`,
                    animationDelay: `${petal.delay}s`,
                    "--sway": `${petal.sway}px`,
                    "--o": petal.opacity,
                  } as CSSProperties
                }
              >
                <svg
                  className="landing-petal-shape"
                  viewBox="0 0 20 24"
                  aria-hidden="true"
                  style={{
                    animationDuration: `${petal.spin}s`,
                    animationDirection: petal.reverse ? "reverse" : "normal",
                  }}
                >
                  <path
                    d={PETAL_PATH}
                    fill="url(#sakuraPetalGrad)"
                  />
                </svg>
              </span>
            ))}
            <svg
              className="landing-petal-defs"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="sakuraPetalGrad"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="#ec6fa0"
                  />
                  <stop
                    offset="100%"
                    stopColor="#ffe1ec"
                  />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="landing-photo-frame relative h-[27rem] sm:h-[34rem] lg:absolute lg:inset-0 lg:h-auto">
            <Image
              src="/landing-page.webp"
              alt="A multigenerational family gathered beneath cherry blossoms"
              fill
              priority
              sizes="100vw"
              className="landing-photo object-cover object-[80%_center] sm:object-[72%_center] lg:object-[62%_center]"
            />
          </div>

          <div className="landing-hero-content relative z-20 px-7 pb-8 pt-3 sm:px-8 sm:py-12 lg:grid lg:h-dvh lg:min-h-0 lg:grid-rows-[1fr_auto] lg:px-7 lg:pb-6 lg:pt-0">
            <div className="flex items-start lg:pt-[31vh]">
              <div className="landing-intro max-w-[50rem]">
                <p className="landing-eyebrow mb-4">A private family record</p>
                <h1 className="landing-wordmark text-[clamp(2rem,8.6vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.07em] text-[#10213f] lg:text-[clamp(3.75rem,4.8vw,5.5rem)] lg:leading-[0.9]">
                  <span className="block whitespace-nowrap">
                    Old <span className="text-[#4e7fe8]">Roots.</span>
                  </span>
                  <span className="block whitespace-nowrap">
                    New <span className="text-[#4e7fe8]">Leaves.</span>
                  </span>
                  <span className="block whitespace-nowrap">
                    Everlasting <span className="text-[#4e7fe8]">Tree.</span>
                  </span>
                </h1>

                <p className="mt-7 max-w-xl text-[0.96rem] font-medium leading-7 text-[#294b75] sm:text-base lg:text-[1.15rem] lg:leading-8">
                  Build your family tree, preserve the stories behind every
                  branch, and pass your legacy on.
                </p>

                <div className="landing-social-proof mt-6 flex items-center gap-3">
                  <div
                    className="flex -space-x-2"
                    aria-hidden="true"
                  >
                    <span className="z-10 h-7 w-7 rounded-full border-2 border-[#f8f1e6] bg-[#f5d8e0]" />
                    <span className="z-20 h-7 w-7 rounded-full border-2 border-[#f8f1e6] bg-[#dbe5fb]" />
                    <span className="z-30 h-7 w-7 rounded-full border-2 border-[#f8f1e6] bg-[#e4ddd0]" />
                    <span className="z-40 grid h-7 w-7 place-items-center rounded-full border-2 border-[#f8f1e6] bg-[#173860] text-[0.6rem] font-bold text-white">
                      +61
                    </span>
                  </div>
                  <p className="text-sm font-medium text-[#5271a3]">
                    Many generations, one place
                  </p>
                </div>

                <div className="mt-7">
                  <GoogleSignInButton
                    label="Continue with Google"
                    className="landing-google-button w-full px-6 shadow-[0_8px_20px_rgb(19_19_20/0.18)] lg:w-auto"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
