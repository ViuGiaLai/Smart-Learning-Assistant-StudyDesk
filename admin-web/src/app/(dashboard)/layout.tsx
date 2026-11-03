import { Suspense, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/toast";

// Toàn bộ khu vực quản trị phụ thuộc phiên đăng nhập ở phía client,
// nên cho phép route chờ dữ liệu thay vì prerender tĩnh.
export const instant = false;

function AppFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3 text-slate-500">
        <div className="size-10 animate-pulse rounded-2xl bg-white shadow-sm" />
        <p className="text-sm">Đang tải bảng điều khiển…</p>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <Suspense fallback={<AppFallback />}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </ToastProvider>
  );
}
