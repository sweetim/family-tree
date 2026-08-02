import Image from "next/image"
import { GoogleSignInButton } from "./GoogleSignInButton"

const productFacts = [
  "Private by default",
  "Invite relatives as viewers or editors",
]

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
        <section className="landing-hero grid min-h-dvh bg-[#101d46] lg:h-dvh lg:min-h-0 lg:grid-cols-[46%_54%]">
          <div className="relative z-20 flex items-center">
            <div className="w-full px-5 pb-12 pt-28 sm:px-8 sm:pb-16 sm:pt-32 lg:ml-auto lg:max-w-[46rem] lg:px-12 lg:pb-12 lg:pt-28">
              <p className="landing-utility mb-6 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-cobalt-200 sm:mb-8 sm:text-[11px]">
                <span className="h-px w-8 bg-cobalt-400" />
                Private family workspace
              </p>

              <h1 className="landing-display text-[clamp(2.4rem,12vw,5rem)] font-bold uppercase leading-[0.84] tracking-[-0.06em] text-white lg:text-[clamp(3.1rem,5vw,6rem)]">
                <span className="block whitespace-nowrap">
                  Every <span className="text-cobalt-300">branch,</span>
                </span>
                <span className="block">in its</span>
                <span className="block">place.</span>
              </h1>

              <p className="mt-8 max-w-[31rem] text-base leading-7 text-slate-300 sm:mt-10 sm:text-lg sm:leading-8">
                Start with one person. FamiKi arranges partners, parents, and
                children while your family adds the dates, photos, and details
                worth remembering.
              </p>

              <div className="mt-8 flex flex-col items-start gap-3 sm:mt-10 sm:flex-row sm:items-center sm:gap-4">
                <GoogleSignInButton
                  variant="landing"
                  size="lg"
                  label="Continue with Google"
                  className="focus-visible:ring-cobalt-300 focus-visible:ring-offset-[#101d46]"
                />
              </div>

              <ul className="landing-utility mt-10 flex max-w-[38rem] flex-wrap border-t border-white/20 pt-5 text-[9px] font-semibold uppercase tracking-[0.12em] text-cobalt-100 sm:mt-12 sm:text-[10px]">
                {productFacts.map((fact) => (
                  <li
                    key={fact}
                    className="after:mx-3 after:text-cobalt-400 after:content-['·'] last:after:hidden sm:after:mx-4"
                  >
                    {fact}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="relative aspect-[4/3] min-h-[18rem] overflow-hidden sm:min-h-[28rem] lg:h-dvh lg:min-h-0 lg:aspect-auto">
            <Image
              src="/landing-family-archive.webp"
              alt="Several generations arranging family photographs into a tree with cobalt thread"
              fill
              priority
              sizes="(min-width: 1024px) 54vw, 100vw"
              className="object-cover object-[center_44%]"
            />
            <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-28 bg-gradient-to-r from-[#101d46] to-transparent lg:block" />
          </div>
        </section>
      </main>
    </div>
  )
}
