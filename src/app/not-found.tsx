import { redirect } from "next/navigation"

/** Unknown routes land here — mirror the old SPA's `* → /` redirect. */
export default function NotFound() {
  redirect("/")
}
