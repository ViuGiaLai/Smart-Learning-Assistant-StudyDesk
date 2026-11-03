"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { AlertIcon, CheckIcon, CloseIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastApi {
  toast: (input: {
    title: string;
    description?: string;
    tone?: ToastTone;
  }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback<ToastApi["toast"]>(
    ({ title, description, tone = "info" }) => {
      counter += 1;
      const id = counter;
      setItems((current) => [...current.slice(-2), { id, title, description, tone }]);
      setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "animate-slide-up pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-lg",
              item.tone === "success" && "border-emerald-200",
              item.tone === "error" && "border-rose-200",
              item.tone === "info" && "border-slate-200",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                item.tone === "success" && "bg-emerald-50 text-emerald-600",
                item.tone === "error" && "bg-rose-50 text-rose-600",
                item.tone === "info" && "bg-indigo-50 text-indigo-600",
              )}
            >
              {item.tone === "success" ? (
                <CheckIcon className="size-3.5" />
              ) : (
                <AlertIcon className="size-3.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Đóng thông báo"
              className="cursor-pointer rounded p-0.5 text-slate-400 transition hover:text-slate-700"
            >
              <CloseIcon className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast phải nằm trong ToastProvider");
  }
  return context;
}
