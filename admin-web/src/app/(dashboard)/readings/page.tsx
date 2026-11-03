"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ActivityIcon,
  CpuIcon,
  DropletIcon,
  RefreshIcon,
  SunIcon,
  ThermometerIcon,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  TableShell,
  TableSkeleton,
  tbodyClass,
  tdClass,
  thClass,
  theadClass,
  trClass,
} from "@/components/ui";
import { buildQuery } from "@/lib/api";
import {
  formatDateTime,
  formatHumidity,
  formatLux,
  formatNumber,
  formatTemp,
} from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AdminDevice, AdminReading, Page } from "@/lib/types";

const RANGES = [
  { value: 1, label: "1 giờ qua" },
  { value: 6, label: "6 giờ qua" },
  { value: 24, label: "24 giờ qua" },
  { value: 72, label: "3 ngày qua" },
  { value: 168, label: "7 ngày qua" },
  { value: 720, label: "30 ngày qua" },
];

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export default function ReadingsPage() {
  const [hours, setHours] = useState(24);
  const [deviceId, setDeviceId] = useState("");
  const [page, setPage] = useState(1);

  const devices = useApi<Page<AdminDevice>>("/admin/devices?page_size=100");
  const path = `/admin/readings${buildQuery({
    hours,
    device_id: deviceId || undefined,
    page,
    page_size: 30,
  })}`;
  const { data, loading, error, reload } = useApi<Page<AdminReading>>(path);

  const items = data?.items ?? [];
  const avgTemp = average(items.map((item) => item.temperature));
  const avgHumidity = average(items.map((item) => item.humidity));
  const avgLight = average(items.map((item) => item.light_lux));

  return (
    <>
      <PageHeader
        title="Dữ liệu cảm biến"
        description="Tra cứu lịch sử telemetry từ tất cả thiết bị theo khoảng thời gian."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              reload();
              devices.reload();
            }}
            loading={loading}
          >
            <RefreshIcon className="size-3.5" />
            Làm mới
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bản ghi trong khoảng"
          value={formatNumber(data?.total ?? 0)}
          hint={RANGES.find((range) => range.value === hours)?.label}
          icon={<ActivityIcon className="size-5" />}
          tone="indigo"
        />
        <StatCard
          label="Nhiệt độ TB (trang này)"
          value={formatTemp(avgTemp)}
          icon={<ThermometerIcon className="size-5" />}
          tone="rose"
        />
        <StatCard
          label="Độ ẩm TB (trang này)"
          value={formatHumidity(avgHumidity)}
          icon={<DropletIcon className="size-5" />}
          tone="sky"
        />
        <StatCard
          label="Ánh sáng TB (trang này)"
          value={formatLux(avgLight)}
          icon={<SunIcon className="size-5" />}
          tone="amber"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <CpuIcon className="size-4 text-slate-400" />
            <Select
              value={deviceId}
              onChange={(event) => {
                setDeviceId(event.target.value);
                setPage(1);
              }}
              className="w-56"
              aria-label="Lọc theo thiết bị"
            >
              <option value="">Tất cả thiết bị</option>
              {(devices.data?.items ?? []).map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.device_code})
                </option>
              ))}
            </Select>
          </div>
          <Select
            value={hours}
            onChange={(event) => {
              setHours(Number(event.target.value));
              setPage(1);
            }}
            className="w-40"
            aria-label="Khoảng thời gian"
          >
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </Select>
          <p className="ml-auto text-xs text-slate-500">
            {data ? (
              <>
                <span className="font-semibold text-slate-800">
                  {formatNumber(data.total)}
                </span>{" "}
                bản ghi
              </>
            ) : (
              "Đang tải…"
            )}
          </p>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={10} columns={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data && data.items.length > 0 ? (
          <>
            <TableShell>
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Thời gian ghi nhận</th>
                    <th className={thClass}>Thiết bị</th>
                    <th className={thClass}>Nhiệt độ</th>
                    <th className={thClass}>Độ ẩm</th>
                    <th className={thClass}>Ánh sáng</th>
                    <th className={thClass}>Chuyển động</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {data.items.map((reading) => (
                    <tr key={reading.id} className={trClass}>
                      <td className={tdClass}>
                        <p className="text-slate-700">
                          {formatDateTime(reading.recorded_at)}
                        </p>
                        <p className="text-[10px] text-slate-400">UTC</p>
                      </td>
                      <td className={tdClass}>
                        <Link
                          href={`/devices/${reading.device_id}`}
                          className="font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          {reading.device_name}
                        </Link>
                        <p className="font-mono text-[10px] text-slate-400">
                          {reading.device_code}
                        </p>
                      </td>
                      <td className={tdClass}>{formatTemp(reading.temperature)}</td>
                      <td className={tdClass}>{formatHumidity(reading.humidity)}</td>
                      <td className={tdClass}>{formatLux(reading.light_lux)}</td>
                      <td className={tdClass}>
                        <Badge tone={reading.motion_detected ? "indigo" : "slate"}>
                          {reading.motion_detected ? "Có" : "Không"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            <Pagination
              page={data.page}
              pageSize={data.page_size}
              total={data.total}
              onChange={setPage}
            />
          </>
        ) : (
          <EmptyState
            title="Không có dữ liệu trong khoảng này"
            description="Thử mở rộng khoảng thời gian hoặc chọn thiết bị khác."
          />
        )}
      </Card>
    </>
  );
}
