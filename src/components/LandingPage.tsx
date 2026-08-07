import Image from "next/image"
import { GoogleSignInButton } from "./GoogleSignInButton"

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
        <section className="landing-hero relative isolate min-h-dvh overflow-hidden lg:h-dvh">
          <div className="relative h-[27rem] sm:h-[34rem] lg:absolute lg:inset-0 lg:h-auto">
            <Image
              src="/landing-page.webp"
              alt="A multigenerational family gathered beneath cherry blossoms"
              fill
              priority
              sizes="100vw"
              className="landing-photo object-cover object-[80%_center] sm:object-[72%_center] lg:object-[62%_center]"
            />
          </div>

          <div className="relative z-20 px-6 py-10 sm:px-8 sm:py-12 lg:grid lg:h-dvh lg:min-h-0 lg:grid-rows-[1fr_auto] lg:px-7 lg:pb-6 lg:pt-0">
            <div className="flex items-start lg:pt-[31vh]">
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
          </div>
        </section>
      </main>
    </div>
  )
}
