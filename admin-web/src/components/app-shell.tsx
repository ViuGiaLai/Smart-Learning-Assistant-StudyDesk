"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  ActivityIcon,
  BellIcon,
  BookIcon,
  CloseIcon,
  CpuIcon,
  DashboardIcon,
  LogoutIcon,
  MenuIcon,
  ServerIcon,
  UsersIcon,
} from "@/components/icons";
import { Button, ErrorState, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import type { User } from "@/lib/types";

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  description: string;
  icon: (props: { className?: string }) => ReactNode;
}> = [
  {
    href: "/",
    label: "Tổng quan",
    description: "Số liệu chung",
    icon: DashboardIcon,
  },
  {
    href: "/users",
    label: "Người dùng",
    description: "Tài khoản & quyền",
    icon: UsersIcon,
  },
  {
    href: "/devices",
    label: "Thiết bị",
    description: "ESP32 & cảm biến",
    icon: CpuIcon,
  },
  {
    href: "/readings",
    label: "Dữ liệu cảm biến",
    description: "Nhiệt độ, độ ẩm, ánh sáng",
    icon: ActivityIcon,
  },
  {
    href: "/notifications",
    label: "Thông báo",
    description: "Gửi & lịch sử",
    icon: BellIcon,
  },
  {
    href: "/study",
    label: "Học tập",
    description: "Phiên & kế hoạch",
    icon: BookIcon,
  },
  {
    href: "/system",
    label: "Hệ thống",
    description: "Cấu hình & sức khoẻ",
    icon: ServerIcon,
  },
];

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Tổng quan";
  const item = NAV_ITEMS.find(
    (nav) => nav.href !== "/" && pathname.startsWith(nav.href),
  );
  return item?.label ?? "Quản trị";
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
              active
                ? "bg-indigo-50 font-semibold text-indigo-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg transition",
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block leading-tight">{item.label}</span>
              <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-400">
                {item.description}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-200">
        <BookIcon className="size-4.5" />
      </span>
      <div>
        <p className="text-sm font-bold tracking-tight text-slate-900">
          SmartStudy
        </p>
        <p className="text-[10px] font-medium tracking-[0.18em] text-slate-400 uppercase">
          Admin Console
        </p>
      </div>
    </div>
  );
}

function UserCard({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
        {initials(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
        <p className="truncate text-[11px] text-slate-400">{user.email}</p>
      </div>
      <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-emerald-200 ring-inset">
        ADMIN
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<{
    user: User | null;
    error: string | null;
    loading: boolean;
  }>({ user: null, error: null, loading: true });
  const { user, error, loading } = state;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadUser() {
      try {
        const response = await fetch("/api/auth/me", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          throw new Error("Không tải được hồ sơ quản trị viên");
        }
        const data = (await response.json()) as User;
        if (data.role !== "admin") {
          router.replace("/login");
          return;
        }
        if (!controller.signal.aborted) {
          setState({ user: data, error: null, loading: false });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          user: null,
          error: err instanceof Error ? err.message : "Lỗi kết nối",
          loading: false,
        });
      }
    }

    void loadUser();
    return () => controller.abort();
  }, [router, version]);

  const retry = () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    setVersion((value) => value + 1);
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  if (loading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-sm">
            <Spinner className="size-6 text-indigo-600" />
          </div>
          <p className="text-sm">Đang kiểm tra phiên đăng nhập…</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <ErrorState message={error ?? "Phiên đăng nhập không hợp lệ"} onRetry={retry} />
          <div className="flex justify-center pb-5">
            <Button variant="ghost" size="sm" onClick={logout} loading={loggingOut}>
              Đăng xuất
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-slate-200 bg-white lg:flex">
        <Brand />
        <NavLinks pathname={pathname} />
        <UserCard user={user} />
      </aside>

      {/* Sidebar mobile */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Đóng menu"
            className="absolute inset-0 cursor-default bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="animate-slide-up relative flex h-full w-[280px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                aria-label="Đóng menu"
                className="mr-4 cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                onClick={() => setDrawerOpen(false)}
              >
                <CloseIcon className="size-5" />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <UserCard user={user} />
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              type="button"
              aria-label="Mở menu"
              className="cursor-pointer rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                Quản trị hệ thống
              </p>
              <h1 className="truncate text-base font-semibold text-slate-900">
                {pageTitle(pathname)}
              </h1>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700 sm:flex">
              <span className="status-dot-online size-1.5 rounded-full bg-emerald-500" />
              Đã kết nối API
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={logout}
              loading={loggingOut}
              className="shrink-0"
            >
              <LogoutIcon className="size-3.5" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="animate-fade-in">{children}</div>
        </main>

        <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 text-center text-[11px] text-slate-400 sm:px-6 lg:px-8">
          SmartStudy Admin · Smart Learning Assistant
        </footer>
      </div>
    </div>
  );
}
