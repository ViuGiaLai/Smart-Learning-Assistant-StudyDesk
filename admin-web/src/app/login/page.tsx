"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  AlertIcon,
  BookIcon,
  CheckIcon,
  EyeIcon,
  RefreshIcon,
  ServerIcon,
  SparklesIcon,
  UsersIcon,
} from "@/components/icons";
import { Button, Field, Input } from "@/components/ui";

const FEATURES = [
  {
    icon: UsersIcon,
    title: "Quản lý người dùng",
    description: "Phân quyền, hồ sơ và hoạt động học tập.",
  },
  {
    icon: ServerIcon,
    title: "Thiết bị IoT",
    description: "Theo dõi ESP32, ngưỡng cảm biến và lệnh MQTT.",
  },
  {
    icon: SparklesIcon,
    title: "Thông báo thông minh",
    description: "Gửi push FCM tới từng người hoặc toàn bộ.",
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      if (!response.ok) {
        setError(data.detail ?? "Đăng nhập thất bại");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      <div className="relative hidden w-1/2 overflow-hidden bg-slate-950 lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.35),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(139,92,246,0.25),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.07)_1px,transparent_1px)] bg-[size:48px_48px]" />

        <div className="relative flex flex-1 flex-col p-12">
          <div className="flex items-center gap-3">
            <div className="relative size-12 shrink-0 overflow-hidden rounded-2xl border border-white/20 bg-white p-1 shadow-lg shadow-black/20">
              <Image
                src="/logo.png"
                alt="SmartStudy Logo"
                width={48}
                height={48}
                className="size-full object-contain"
                priority
              />
            </div>
            <div>
              <p className="text-sm font-bold text-white">SmartStudy</p>
              <p className="text-[10px] tracking-[0.2em] text-indigo-200/70 uppercase">
                Admin Console
              </p>
            </div>
          </div>

          <div className="my-auto max-w-md">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Trung tâm điều hành
              <br />
              Smart Learning Assistant
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Giám sát người dùng, thiết bị ESP32 và dữ liệu học tập trong một
              giao diện duy nhất. Gửi thông báo, điều khiển thiết bị và theo dõi
              sức khoẻ hệ thống theo thời gian thực.
            </p>

            <div className="mt-10 space-y-4">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div key={feature.title} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-indigo-200 ring-1 ring-white/10">
                      <Icon className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {feature.title}
                      </p>
                      <p className="text-xs text-slate-400">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            FastAPI · Supabase · MQTT · Firebase Cloud Messaging
          </p>
        </div>
      </div>

      <div className="flex w-full items-center justify-center px-4 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 relative size-14 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-md">
              <Image
                src="/logo.png"
                alt="SmartStudy Logo"
                width={56}
                height={56}
                className="size-full object-contain"
                priority
              />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              SmartStudy Admin
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Đăng nhập để quản trị hệ thống.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6 hidden lg:block">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                Đăng nhập quản trị
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Chỉ tài khoản có vai trò <strong>admin</strong> mới được phép.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </Field>

              <Field label="Mật khẩu" htmlFor="password">
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-3 text-slate-400 transition hover:text-slate-600"
                  >
                    <EyeIcon className="size-4" />
                  </button>
                </div>
              </Field>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                className="w-full justify-center"
                loading={submitting}
              >
                {!submitting ? <CheckIcon className="size-4" /> : null}
                {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
              </Button>
            </form>

            <div className="mt-6 rounded-xl bg-slate-50 p-3.5 text-[11px] leading-relaxed text-slate-500">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-slate-700">
                <RefreshIcon className="size-3" />
                Chưa có quyền admin?
              </p>
              <p>
                Trong thư mục <code className="rounded bg-white px-1 py-0.5 text-[10px] text-indigo-600 ring-1 ring-slate-200">backend/</code> chạy:
              </p>
              <code className="mt-1.5 block overflow-x-auto rounded-lg bg-slate-900 px-2.5 py-2 font-mono text-[10px] text-emerald-300">
                python -m scripts.make_admin --email you@example.com
              </code>
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] text-slate-400">
            © Smart Learning Assistant. Khu vực nội bộ.
          </p>
        </div>
      </div>
    </div>
  );
}
