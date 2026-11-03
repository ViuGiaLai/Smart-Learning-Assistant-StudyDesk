"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { AreaChart, BarList } from "@/components/charts";
import {
  ActivityIcon,
  BellIcon,
  BookIcon,
  CpuIcon,
  DatabaseIcon,
  RefreshIcon,
  ServerIcon,
  SparklesIcon,
  UsersIcon,
  WifiIcon,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatCard,
  TableShell,
  tbodyClass,
  tdClass,
  thClass,
  theadClass,
  trClass,
} from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import {
  formatDay,
  formatNumber,
  formatDateTime,
  initials,
  notificationTypeLabel,
} from "@/lib/format";
import type { AdminStats, AdminUser, Page } from "@/lib/types";

type Metric = "readings" | "alerts" | "users";

const METRICS: Array<{ key: Metric; label: string; color: string; suffix: string }> = [
  { key: "readings", label: "Lượt đọc cảm biến", color: "#4f46e5", suffix: " lượt" },
  { key: "alerts", label: "Cảnh báo", color: "#f43f5e", suffix: " cảnh báo" },
  { key: "users", label: "Người dùng mới", color: "#059669", suffix: " người" },
];

function SystemRow({
  icon,
  label,
  value,
  ok,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  ok?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-700">{label}</p>
        {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
      </div>
      {ok === undefined ? (
        <span className="max-w-[45%] truncate text-right text-xs font-medium text-slate-600">
          {value}
        </span>
      ) : (
        <Badge tone={ok ? "emerald" : "amber"} dot>
          {value}
        </Badge>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const stats = useApi<AdminStats>("/admin/stats");
  const users = useApi<Page<AdminUser>>("/admin/users?page_size=6");
  const [metric, setMetric] = useState<Metric>("readings");

  const refresh = () => {
    stats.reload();
    users.reload();
  };

  const data = stats.data;
  const activeMetric = METRICS.find((item) => item.key === metric) ?? METRICS[0];

  const chartData =
    metric === "readings"
      ? (data?.readings_daily ?? []).map((item) => ({
          label: formatDay(item.date),
          value: item.readings,
        }))
      : metric === "alerts"
        ? (data?.alerts_daily ?? []).map((item) => ({
            label: formatDay(item.date),
            value: item.count,
          }))
        : (data?.users_daily ?? []).map((item) => ({
            label: formatDay(item.date),
            value: item.count,
          }));

  return (
    <>
      <PageHeader
        title="Tổng quan hệ thống"
        description="Số liệu tổng hợp về người dùng, thiết bị IoT, dữ liệu cảm biến và hoạt động học tập."
        actions={
          <Button variant="secondary" onClick={refresh} loading={stats.loading}>
            <RefreshIcon className="size-3.5" />
            Làm mới
          </Button>
        }
      />

      {stats.error ? (
        <Card>
          <ErrorState message={stats.error} onRetry={stats.reload} />
        </Card>
      ) : stats.loading && !data ? (
        <Card>
          <LoadingBlock label="Đang tổng hợp số liệu…" />
        </Card>
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Người dùng"
              value={formatNumber(data.total_users)}
              hint={`${formatNumber(data.admins)} quản trị viên`}
              icon={<UsersIcon className="size-5" />}
              tone="indigo"
            />
            <StatCard
              label="Thiết bị"
              value={formatNumber(data.total_devices)}
              hint={
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {formatNumber(data.online_devices)} online ·{" "}
                  {formatNumber(data.offline_devices)} offline
                </span>
              }
              icon={<CpuIcon className="size-5" />}
              tone="sky"
            />
            <StatCard
              label="Đọc cảm biến (24h)"
              value={formatNumber(data.readings_24h)}
              hint={`Tổng ${formatNumber(data.total_readings)} bản ghi`}
              icon={<ActivityIcon className="size-5" />}
              tone="violet"
            />
            <StatCard
              label="Thông báo chưa đọc"
              value={formatNumber(data.unread_notifications)}
              hint={`${formatNumber(data.alerts_24h)} cảnh báo trong 24h`}
              icon={<BellIcon className="size-5" />}
              tone={data.unread_notifications > 0 ? "amber" : "slate"}
            />
            <StatCard
              label="Phiên học đang chạy"
              value={formatNumber(data.active_sessions)}
              hint={`${formatNumber(data.total_sessions)} phiên · ${formatNumber(data.total_plans)} kế hoạch`}
              icon={<BookIcon className="size-5" />}
              tone="emerald"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Xu hướng 7 ngày"
                description={`${activeMetric.label} theo ngày (múi giờ ${data.timezone}).`}
                actions={
                  <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                    {METRICS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setMetric(item.key)}
                        className={cn(
                          "cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                          metric === item.key
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-500 hover:text-slate-800",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="px-2 py-4">
                <AreaChart
                  data={chartData}
                  color={activeMetric.color}
                  suffix={activeMetric.suffix}
                  height={260}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Trạng thái hệ thống"
                description="Kết nối và nhà cung cấp dịch vụ."
                actions={
                  <Link
                    href="/system"
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Chi tiết
                  </Link>
                }
              />
              <div className="divide-y divide-slate-100">
                <SystemRow
                  icon={<ServerIcon className="size-4" />}
                  label="Backend API"
                  value={data.environment}
                  ok
                />
                <SystemRow
                  icon={<WifiIcon className="size-4" />}
                  label="MQTT broker"
                  value={data.mqtt_connected ? "Đã kết nối" : "Mất kết nối"}
                  ok={data.mqtt_connected}
                />
                <SystemRow
                  icon={<BellIcon className="size-4" />}
                  label="Firebase Cloud Messaging"
                  value={data.fcm_enabled ? "Đang bật" : "Chưa cấu hình"}
                  ok={data.fcm_enabled}
                  hint={`${formatNumber(data.total_tokens)} thiết bị đăng ký push`}
                />
                <SystemRow
                  icon={<SparklesIcon className="size-4" />}
                  label="Trợ lý AI"
                  value={data.ai_provider}
                  hint="Nhà cung cấp đang hoạt động"
                />
                <SystemRow
                  icon={<DatabaseIcon className="size-4" />}
                  label="Xác thực"
                  value={data.auth_provider}
                  hint="Nguồn cấp token"
                />
              </div>
              <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-[11px] text-slate-400">
                Cập nhật lúc {formatDateTime(data.generated_at)}
              </div>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Người dùng mới nhất"
                description="6 tài khoản đăng ký gần đây."
                actions={
                  <Link
                    href="/users"
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Xem tất cả
                  </Link>
                }
              />
              {users.loading && !users.data ? (
                <LoadingBlock label="Đang tải người dùng…" />
              ) : users.error ? (
                <ErrorState message={users.error} onRetry={users.reload} />
              ) : users.data && users.data.items.length > 0 ? (
                <TableShell>
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Người dùng</th>
                        <th className={thClass}>Vai trò</th>
                        <th className={thClass}>Thiết bị</th>
                        <th className={thClass}>Ngày tham gia</th>
                      </tr>
                    </thead>
                    <tbody className={tbodyClass}>
                      {users.data.items.map((user) => (
                        <tr key={user.id} className={trClass}>
                          <td className={tdClass}>
                            <div className="flex items-center gap-2.5">
                              <span className="flex size-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                                {initials(user.name)}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">
                                  {user.name}
                                </p>
                                <p className="truncate text-[11px] text-slate-400">
                                  {user.email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className={tdClass}>
                            <Badge tone={user.role === "admin" ? "indigo" : "slate"}>
                              {user.role === "admin" ? "Quản trị" : "Học viên"}
                            </Badge>
                          </td>
                          <td className={tdClass}>{formatNumber(user.devices_count)}</td>
                          <td className={tdClass}>{formatDateTime(user.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              ) : (
                <EmptyState
                  title="Chưa có người dùng"
                  description="Tài khoản đăng ký từ ứng dụng di động sẽ xuất hiện tại đây."
                />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Cảnh báo theo loại"
                description="7 ngày gần nhất."
              />
              <BarList
                items={data.alerts_by_type.map((item) => ({
                  label: notificationTypeLabel(item.label),
                  count: item.count,
                }))}
                tone="rose"
                emptyLabel="Chưa có cảnh báo nào trong 7 ngày."
              />
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
