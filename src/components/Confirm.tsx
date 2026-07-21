import { AlertTriangle } from "lucide-react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"

type ConfirmTone = "danger" | "default"

type ConfirmOptions = {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmTone
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}

type Pending = ConfirmOptions & { resolve: (value: boolean) => void }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>()

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  const close = useCallback(
    (value: boolean) => {
      pending?.resolve(value)
      setPending(undefined)
    },
    [pending],
  )

  useEffect(() => {
    if (!pending) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false)
      if (event.key === "Enter") close(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pending, close])

  const isDanger = pending?.tone === "danger"

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a convenience; Escape (handled above) is the keyboard equivalent
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close is via the Escape listener in the effect above
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 animate-fade-in"
          onClick={(event) => {
            if (event.target === event.currentTarget) close(false)
          }}
        >
          <div className="w-full max-w-sm animate-scale-in rounded-2xl bg-white p-6 shadow-lift">
            <div className="flex items-start gap-3">
              {isDanger && (
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-800">
                  {pending.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-500">
                  {pending.message}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
              >
                {pending.cancelText ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors active:scale-95 ${
                  isDanger
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-cobalt-600 hover:bg-cobalt-700"
                }`}
              >
                {pending.confirmText ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
