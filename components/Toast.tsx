"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "info";
  durationMs?: number;
};

type ToastContextValue = {
  toast: (input: Omit<ToastItem, "id"> | string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: Omit<ToastItem, "id"> | string) => {
    const payload =
      typeof input === "string"
        ? { title: input, variant: "success" as const }
        : input;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: ToastItem = {
      id,
      durationMs: 4500,
      variant: "success",
      ...payload,
    };
    setItems((prev) => [...prev, item]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed top-4 right-4 z-[200] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const ms = item.durationMs ?? 4500;
    if (ms <= 0) return;
    const t = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(t);
  }, [item.durationMs, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg animate-in fade-in-0 slide-in-from-top-2",
        item.variant === "success" && "border-emerald-200",
        item.variant === "info" && "border-sky-200",
        (!item.variant || item.variant === "default") && "border-slate-200"
      )}
      role="status"
    >
      <CheckCircle2
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          item.variant === "success" && "text-emerald-600",
          item.variant === "info" && "text-sky-600",
          (!item.variant || item.variant === "default") && "text-slate-500"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
