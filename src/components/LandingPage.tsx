import { ArrowRight, Check, LockKeyhole, Sparkles } from "lucide-react"
import Image from "next/image"
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react"
import { GoogleSignInButton } from "./GoogleSignInButton"

type FamilyPerson = {
  name: string
  detail: string
  initials: string
  left: string
  top: string
  depth: string
  animationDelay: string
  avatarClassName: string
}

const familyPeople: FamilyPerson[] = [
  {
    name: "James",
    detail: "Grandfather",
    initials: "J",
    left: "38%",
    top: "4%",
    depth: "28px",
    animationDelay: "0.2s",
    avatarClassName: "bg-amber-200 text-amber-950",
  },
  {
    name: "Ruth",
    detail: "Grandmother",
    initials: "R",
    left: "62%",
    top: "4%",
    depth: "28px",
    animationDelay: "0.45s",
    avatarClassName: "bg-rose-200 text-rose-950",
  },
  {
    name: "Elena",
    detail: "Daughter",
    initials: "E",
    left: "9%",
    top: "42%",
    depth: "12px",
    animationDelay: "1.85s",
    avatarClassName: "bg-violet-200 text-violet-950",
  },
  {
    name: "Marcus",
    detail: "Son",
    initials: "M",
    left: "36%",
    top: "42%",
    depth: "22px",
    animationDelay: "2.1s",
    avatarClassName: "bg-sky-200 text-sky-950",
  },
  {
    name: "Sofia",
    detail: "Partner",
    initials: "S",
    left: "57%",
    top: "42%",
    depth: "22px",
    animationDelay: "2.45s",
    avatarClassName: "bg-emerald-200 text-emerald-950",
  },
  {
    name: "Leah",
    detail: "Daughter",
    initials: "L",
    left: "88%",
    top: "42%",
    depth: "12px",
    animationDelay: "2.7s",
    avatarClassName: "bg-orange-200 text-orange-950",
  },
  {
    name: "Eli",
    detail: "Grandson",
    initials: "E",
    left: "43%",
    top: "78%",
    depth: "4px",
    animationDelay: "3.85s",
    avatarClassName: "bg-cobalt-100 text-cobalt-900",
  },
  {
    name: "Zoe",
    detail: "Granddaughter",
    initials: "Z",
    left: "65%",
    top: "78%",
    depth: "4px",
    animationDelay: "4.15s",
    avatarClassName: "bg-pink-200 text-pink-950",
  },
]

function FamilyPersonCard({ person }: { person: FamilyPerson }) {
  return (
    <div
      className="family-person-card absolute z-10 w-20 rounded-xl border border-white/80 bg-white/90 p-1.5 shadow-[0_12px_35px_rgba(36,29,22,0.13)] backdrop-blur sm:w-24 sm:rounded-2xl sm:p-2 lg:w-28 lg:p-2.5"
      style={
        {
          left: person.left,
          top: person.top,
          "--family-node-delay": person.animationDelay,
          "--family-node-depth": person.depth,
        } as CSSProperties
      }
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold sm:h-8 sm:w-8 sm:rounded-xl sm:text-xs lg:h-9 lg:w-9 ${person.avatarClassName}`}
        >
          {person.initials}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[9px] font-bold text-[#27241f] sm:text-[11px] lg:text-xs">
            {person.name}
          </span>
          <span className="hidden truncate text-[8px] text-[#777064] sm:block lg:text-[10px]">
            {person.detail}
          </span>
        </span>
      </div>
    </div>
  )
}

function GrowingFamilyTree() {
  const [animationCycle, setAnimationCycle] = useState(0)

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (reducedMotion.matches) return

    const interval = window.setInterval(
      () => setAnimationCycle((cycle) => cycle + 1),
      12_000,
    )
    return () => window.clearInterval(interval)
  }, [])

  function updatePerspective(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return
    const bounds = event.currentTarget.getBoundingClientRect()
    const horizontalPosition =
      (event.clientX - bounds.left) / bounds.width - 0.5
    const verticalPosition = (event.clientY - bounds.top) / bounds.height - 0.5
    event.currentTarget.style.setProperty(
      "--tree-rotate-x",
      `${-verticalPosition * 5}deg`,
    )
    event.currentTarget.style.setProperty(
      "--tree-rotate-y",
      `${horizontalPosition * 7}deg`,
    )
  }

  function resetPerspective(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--tree-rotate-x", "0deg")
    event.currentTarget.style.setProperty("--tree-rotate-y", "0deg")
  }

  return (
    <div
      className="family-tree-perspective one-screen-tree relative mx-auto w-full max-w-[720px]"
      onPointerMove={updatePerspective}
      onPointerLeave={resetPerspective}
    >
      <div className="absolute -inset-8 rounded-[50%] bg-[radial-gradient(circle,rgba(75,99,214,0.2),transparent_65%)] blur-2xl" />
      <div className="family-tree-stage relative aspect-[1.35] overflow-hidden rounded-[1.5rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.92),rgba(241,236,225,0.82))] shadow-[0_35px_90px_rgba(47,39,27,0.2)] backdrop-blur-xl sm:rounded-[2rem]">
        <div className="absolute inset-x-0 top-0 flex h-9 items-center gap-1.5 border-b border-[#ddd6c8]/80 bg-white/55 px-3 sm:h-11 sm:px-4">
          <span className="h-1.5 w-1.5 rounded-full bg-[#f29b87] sm:h-2 sm:w-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#efc86b] sm:h-2 sm:w-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#8bc9a7] sm:h-2 sm:w-2" />
          <span className="ml-2 text-[7px] font-semibold uppercase tracking-[0.16em] text-[#8b8274] sm:ml-3 sm:text-[9px] sm:tracking-[0.18em]">
            The Morgan family
          </span>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[7px] font-semibold text-emerald-700 shadow-sm sm:text-[8px]">
            <LockKeyhole className="h-2.5 w-2.5" /> Private
          </span>
        </div>

        <div
          key={animationCycle}
          className="family-tree-cycle absolute inset-x-3 bottom-2 top-10 sm:inset-x-5 sm:bottom-4 sm:top-12"
          role="img"
          aria-label="An animated family tree growing across three generations"
        >
          <svg
            viewBox="0 0 700 440"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible"
            aria-hidden="true"
          >
            <path
              pathLength="1"
              d="M266 55 H434"
              className="family-tree-line family-tree-line-warm"
              style={{ "--family-line-delay": "0.85s" } as CSSProperties}
            />
            <path
              pathLength="1"
              d="M350 55 V145"
              className="family-tree-line"
              style={{ "--family-line-delay": "1.15s" } as CSSProperties}
            />
            <path
              pathLength="1"
              d="M63 145 H616"
              className="family-tree-line"
              style={{ "--family-line-delay": "1.4s" } as CSSProperties}
            />
            <path
              pathLength="1"
              d="M63 145 V220 M252 145 V220 M616 145 V220"
              className="family-tree-line"
              style={{ "--family-line-delay": "1.65s" } as CSSProperties}
            />
            <path
              pathLength="1"
              d="M252 216 H399"
              className="family-tree-line family-tree-line-warm"
              style={{ "--family-line-delay": "2.95s" } as CSSProperties}
            />
            <path
              pathLength="1"
              d="M326 216 V304 M301 304 H455"
              className="family-tree-line"
              style={{ "--family-line-delay": "3.25s" } as CSSProperties}
            />
            <path
              pathLength="1"
              d="M301 304 V378 M455 304 V378"
              className="family-tree-line"
              style={{ "--family-line-delay": "3.55s" } as CSSProperties}
            />
          </svg>

          {familyPeople.map((person) => (
            <FamilyPersonCard
              key={person.name}
              person={person}
            />
          ))}

          <div className="family-tree-note absolute bottom-[4%] left-[4%] hidden items-center gap-2 rounded-xl border border-white/80 bg-white/90 px-3 py-2 text-[10px] font-semibold text-[#4e493f] shadow-lg backdrop-blur md:flex">
            <Sparkles className="h-3 w-3 text-cobalt-600" />
            Arranged automatically
          </div>
        </div>
      </div>
    </div>
  )
}

export function LandingPage() {
  return (
    <div className="landing-page flex h-dvh flex-col overflow-hidden bg-[#f7f4ed] text-[#27241f]">
      <header className="relative z-40 shrink-0 border-b border-[#2e2a24]/8 bg-[#f7f4ed]/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-7xl items-center px-4 sm:h-18 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.webp"
              alt=""
              width={44}
              height={44}
              priority
              className="h-10 w-10 object-cover sm:h-11 sm:w-11"
            />
            <span className="text-lg font-bold tracking-[-0.04em]">FamiKi</span>
          </div>
          <GoogleSignInButton
            variant="outline"
            label="Sign in"
            className="ml-auto"
          />
        </nav>
      </header>

      <main className="landing-hero relative min-h-0 flex-1 overflow-hidden">
        <div className="landing-orb landing-orb-left" />
        <div className="landing-orb landing-orb-right" />
        <div className="one-screen-layout relative z-10 mx-auto grid h-full max-w-7xl items-center gap-5 px-4 py-5 sm:px-8 sm:py-7 lg:grid-cols-[0.86fr_1.14fr] lg:gap-10 lg:px-10 lg:py-8">
          <div className="one-screen-copy relative z-10 max-w-2xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#d9d0c0] bg-white/65 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-[#665f53] shadow-sm backdrop-blur sm:mb-6 sm:px-3.5 sm:py-2 sm:text-[10px] sm:tracking-[0.22em]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ed8b63] shadow-[0_0_0_4px_rgba(237,139,99,0.14)]" />
              Private · Collaborative · Yours
            </p>
            <h1 className="landing-display text-[clamp(2.65rem,10vw,4.2rem)] leading-[0.92] tracking-[-0.055em] text-[#29261f] lg:text-[clamp(4rem,6vw,5.5rem)]">
              Your family story,
              <span className="relative mt-1 block text-cobalt-700">
                beautifully connected.
                <svg
                  viewBox="0 0 420 24"
                  className="absolute -bottom-3 left-0 w-[82%] text-[#e9a16f] sm:-bottom-4"
                  aria-hidden="true"
                >
                  <path
                    d="M4 16c94-12 245-13 411-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeLinecap="round"
                    opacity=".55"
                  />
                </svg>
              </span>
            </h1>
            <p className="one-screen-supporting mt-6 max-w-xl text-sm leading-6 text-[#686155] sm:mt-8 sm:text-base sm:leading-7 lg:text-lg lg:leading-8">
              Build a living family tree that organizes every generation,
              memory, and relationship in one private place.
            </p>
            <GoogleSignInButton
              variant="hero"
              size="lg"
              label="Start your family tree"
              trailingIcon={<ArrowRight className="h-4 w-4" />}
              className="mt-5 sm:mt-7"
            />
            <div className="mt-5 hidden flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-[#756e62] sm:flex lg:mt-7">
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-700" /> Private by
                default
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-700" /> Share with
                family
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-700" /> Export
                anytime
              </span>
            </div>
          </div>

          <div className="one-screen-graph relative min-h-0 lg:-mr-24">
            <GrowingFamilyTree />
          </div>
        </div>
      </main>
    </div>
  )
}
