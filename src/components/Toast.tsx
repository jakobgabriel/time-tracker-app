import { useCallback, useRef, useState } from "react";

export type ToastKind = "ok" | "error" | "info";
export type ToastState = { text: string; kind: ToastKind } | null;

/** One toast at a time; a new message replaces the old one. */
export function useToast(): [ToastState, (text: string, kind?: ToastKind) => void] {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, kind: ToastKind = "info") => {
    window.clearTimeout(timer.current);
    setToast({ text, kind });
    timer.current = window.setTimeout(() => setToast(null), kind === "error" ? 5200 : 2600);
  }, []);

  return [toast, show];
}

export function Toast({ toast }: { toast: ToastState }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
