import { useCallback, useRef, useState } from "react";

export type ToastKind = "ok" | "error" | "info";
export type ToastAction = { label: string; run: () => void };
export type ToastState = { text: string; kind: ToastKind; action?: ToastAction } | null;

export type ShowToast = (text: string, kind?: ToastKind, action?: ToastAction) => void;

/** One toast at a time; a new message replaces the old one. */
export function useToast(): [ToastState, ShowToast, () => void] {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ShowToast>((text, kind = "info", action) => {
    window.clearTimeout(timer.current);
    setToast({ text, kind, action });
    // An offer to undo has to outlast a plain acknowledgement.
    const life = action ? 6500 : kind === "error" ? 5200 : 2600;
    timer.current = window.setTimeout(() => setToast(null), life);
  }, []);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  return [toast, show, dismiss];
}

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
      {toast.text}
      {toast.action && (
        <button
          className="undo"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
