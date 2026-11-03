"use client";

import type { ReactNode } from "react";

import {
  AlertIcon,
  BellIcon,
  BookIcon,
  DatabaseIcon,
  ExternalIcon,
  RefreshIcon,
  ServerIcon,
  SparklesIcon,
  WifiIcon,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
  ErrorState,
  LoadingBlock,
  PageHeader,
} from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AdminSystem } from "@/lib/types";

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="max-w-[60%] text-right text-xs font-medium break-words text-slate-800">
        {value}
      </span>
    </div>
  );
}

export default function SystemPage() {
  const { data, loading, error, reload } = useApi<AdminSystem>("/admin/system");
  const docsUrl = process.env.NEXT_PUBLIC_BACKEND_URL
    ? `${process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/+$/, "")}/docs`
    : null;

  return (
    <>
      <PageHeader
        title="Hệ thống"
        description="Cấu hình backend, trạng thái kết nối MQTT, Firebase Cloud Messaging và cơ sở dữ liệu."
        actions={
          <>
            {docsUrl ? (
              <a
                href={docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <ExternalIcon className="size-3.5" />
                API docs
              </a>
            ) : null}
            <Button variant="secondary" onClick={reload} loading={loading}>
              <RefreshIcon className="size-3.5" />
              Kiểm tra lại
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <Card>
          <LoadingBlock label="Đang kiểm tra hệ thống…" />
        </Card>
      ) : error || !data ? (
        <Card>
          <ErrorState message={error ?? "Không tải được thông tin hệ thống"} onRetry={reload} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <ServerIcon className="size-5" />
                </span>
                <div>
                  <p className="text-xs text-slate-500">Backend API</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {data.app_name}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="emerald" dot>
                  Hoạt động
                </Badge>
                <Badge tone="slate">v{data.version}</Badge>
                <Badge tone="indigo">{data.environment}</Badge>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                  <WifiIcon className="size-5" />
                </span>
                <div>
                  <p className="text-xs text-slate-500">MQTT broker</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {data.mqtt_connected ? "Đã kết nối" : "Mất kết nối"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone={data.mqtt_connected ? "emerald" : "rose"} dot>
                  {data.mqtt_connected ? "Online" : "Offline"}
                </Badge>
                <Badge tone="slate">{data.mqtt_host}</Badge>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                  <BellIcon className="size-5" />
                </span>
                <div>
                  <p className="text-xs text-slate-500">Firebase Cloud Messaging</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {data.fcm_enabled ? "Đang bật" : "Chưa cấu hình"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone={data.fcm_enabled ? "emerald" : "amber"} dot>
                  {data.fcm_enabled ? "Sẵn sàng" : "Tắt"}
                </Badge>
                <Badge tone="slate">
                  {formatNumber(data.total_tokens)} token
                </Badge>
              </div>
            </Card>
          </div>

          {!data.fcm_enabled || !data.mqtt_connected || data.auth_provider === "local" ? (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader
                title="Cần chú ý"
                description="Một số dịch vụ chưa được cấu hình đầy đủ."
              />
              <ul className="space-y-2 px-5 py-4 text-xs text-amber-800">
                {!data.fcm_enabled ? (
                  <li className="flex items-start gap-2">
                    <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Push FCM đang tắt. Đặt <code>FIREBASE_CREDENTIALS_FILE</code> trỏ
                      tới service account JSON trên server và khởi động lại backend. Sau
                      đó đăng nhập app native để đăng ký device token.
                    </span>
                  </li>
                ) : null}
                {!data.mqtt_connected ? (
                  <li className="flex items-start gap-2">
                    <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      MQTT chưa kết nối. Kiểm tra <code>MQTT_ENABLED</code>,{" "}
                      <code>MQTT_HOST</code>, tài khoản broker và chứng chỉ TLS.
                    </span>
                  </li>
                ) : null}
                {data.auth_provider === "local" ? (
                  <li className="flex items-start gap-2">
                    <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Đang dùng xác thực local (JWT nội bộ). Chỉ phù hợp cho phát triển;
                      production nên đặt <code>AUTH_PROVIDER=supabase</code>.
                    </span>
                  </li>
                ) : null}
              </ul>
            </Card>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Cấu hình backend" description="Giá trị đang được áp dụng." />
              <div className="py-1">
                <InfoRow label="Tên ứng dụng" value={data.app_name} />
                <InfoRow label="Phiên bản" value={data.version} />
                <InfoRow label="Môi trường" value={data.environment} />
                <InfoRow label="Tiền tố API" value={<code>{data.api_prefix}</code>} />
                <InfoRow label="Cơ sở dữ liệu" value={data.database} />
                <InfoRow label="Múi giờ" value={data.timezone} />
                <InfoRow label="Nhà cung cấp xác thực" value={data.auth_provider} />
                <InfoRow
                  label="Trợ lý AI"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <SparklesIcon className="size-3.5 text-violet-500" />
                      {data.ai_provider}
                    </span>
                  }
                />
                <InfoRow label="Cập nhật lúc" value={formatDateTime(data.generated_at)} />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Hạ tầng & tích hợp"
                description="Broker, FCM và dữ liệu người dùng."
              />
              <div className="py-1">
                <InfoRow
                  label="MQTT host"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <WifiIcon className="size-3.5 text-slate-400" />
                      {data.mqtt_host}
                    </span>
                  }
                />
                <InfoRow label="MQTT topic prefix" value={<code>{data.mqtt_topic_prefix}</code>} />
                <InfoRow
                  label="FCM project"
                  value={data.fcm_project_id ?? "Chưa cấu hình"}
                />
                <InfoRow
                  label="Device token"
                  value={formatNumber(data.total_tokens)}
                />
                <InfoRow
                  label="Database"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <DatabaseIcon className="size-3.5 text-slate-400" />
                      {data.database}
                    </span>
                  }
                />
                <InfoRow label="Tổng người dùng" value={formatNumber(data.total_users)} />
                <InfoRow label="Tổng thiết bị" value={formatNumber(data.total_devices)} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Kết nối Admin Web → Backend"
              description="Admin Web gọi API qua BFF nội bộ, token được giữ trong cookie HttpOnly."
            />
            <div className="space-y-4 px-5 py-5">
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">
                  Biến môi trường server
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">
                    BACKEND_URL=http://127.0.0.1:8000
                  </code>
                  <CopyButton value="BACKEND_URL=http://127.0.0.1:8000" />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Đặt trong <code>admin-web/.env.local</code>. Không cần public ra
                  trình duyệt.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <BookIcon className="size-3.5" />
                  Cấp quyền admin
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Tài khoản phải tồn tại trước (đăng ký trong app), sau đó chạy trong
                  thư mục <code>backend/</code>:
                </p>
                <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">
                  python -m scripts.make_admin --email ban@example.com
                </code>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <ServerIcon className="size-3.5" />
                  Chạy Admin Web
                </p>
                <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-emerald-300">
                  cd admin-web && npm run dev
                </code>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Mặc định mở tại <code>http://localhost:3000</code>.
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
