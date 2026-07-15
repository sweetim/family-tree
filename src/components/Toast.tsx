import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";

type ToastTone = "info" | "success" | "error";

type ToastInput = {
  message: string;
  tone?: ToastTone;
};

type ToastFn = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

type Toast = { id: number; message: string; tone: ToastTone };

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; ring: string; iconColor: string }> = {
  info: { icon: Info, ring: "ring-slate-200", iconColor: "text-cobalt-600" },
  success: { icon: CheckCircle2, ring: "ring-emerald-200", iconColor: "text-emerald-600" },
  error: { icon: XCircle, ring: "ring-red-200", iconColor: "text-red-600" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const push = useCallback<ToastFn>(
    (message, tone = "info") => {
      const id = Date.now() + Math.random();
      setToasts(current => [...current, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map(toast => {
          const { icon: Icon, ring, iconColor } = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white px-4 py-3 shadow-lift ring-1 animate-toast-in ${ring}`}
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
              <p className="flex-1 text-sm leading-relaxed text-slate-700">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
