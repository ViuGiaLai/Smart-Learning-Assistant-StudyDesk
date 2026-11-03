"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ChevronRightIcon,
  CpuIcon,
  RefreshIcon,
  SearchIcon,
} from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
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
  formatHumidity,
  formatLux,
  formatNumber,
  formatTemp,
  relativeTime,
} from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import type { AdminDevice, DeviceStatus, Page } from "@/lib/types";

export default function DevicesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | DeviceStatus>("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  const path = `/admin/devices${buildQuery({
    search: debouncedSearch || undefined,
    status: status || undefined,
    page,
    page_size: 20,
  })}`;

  const { data, loading, error, reload } = useApi<Page<AdminDevice>>(path);

  return (
    <>
      <PageHeader
        title="Thiết bị IoT"
        description="Danh sách ESP32 đã đăng ký, trạng thái kết nối và dữ liệu cảm biến mới nhất."
        actions={
          <Button variant="secondary" onClick={reload} loading={loading}>
            <RefreshIcon className="size-3.5" />
            Làm mới
          </Button>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Tìm mã thiết bị, tên hoặc chủ sở hữu…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "" | DeviceStatus);
              setPage(1);
            }}
            className="w-full sm:w-40"
            aria-label="Lọc theo trạng thái"
          >
            <option value="">Mọi trạng thái</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </Select>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <CpuIcon className="size-4 text-slate-400" />
            {data ? (
              <>
                <span className="font-semibold text-slate-800">
                  {formatNumber(data.total)}
                </span>
                thiết bị
              </>
            ) : (
              "Đang tải…"
            )}
          </div>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={7} columns={7} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data && data.items.length > 0 ? (
          <>
            <TableShell>
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Thiết bị</th>
                    <th className={thClass}>Chủ sở hữu</th>
                    <th className={thClass}>Trạng thái</th>
                    <th className={thClass}>Nhiệt độ</th>
                    <th className={thClass}>Độ ẩm</th>
                    <th className={thClass}>Ánh sáng</th>
                    <th className={thClass}>Lần cuối</th>
                    <th className={thClass} />
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {data.items.map((device) => (
                    <tr key={device.id} className={trClass}>
                      <td className={tdClass}>
                        <p className="font-medium text-slate-800">{device.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">
                          {device.device_code}
                        </p>
                      </td>
                      <td className={tdClass}>
                        <p className="text-sm text-slate-700">{device.owner.name}</p>
                        <p className="text-[11px] text-slate-400">{device.owner.email}</p>
                      </td>
                      <td className={tdClass}>
                        <Badge tone={device.online ? "emerald" : "slate"} dot>
                          {device.online ? "Online" : "Offline"}
                        </Badge>
                      </td>
                      <td className={tdClass}>
                        {formatTemp(device.latest_reading?.temperature)}
                      </td>
                      <td className={tdClass}>
                        {formatHumidity(device.latest_reading?.humidity)}
                      </td>
                      <td className={tdClass}>
                        {formatLux(device.latest_reading?.light_lux)}
                      </td>
                      <td className={tdClass}>{relativeTime(device.last_seen_at)}</td>
                      <td className={`${tdClass} text-right`}>
                        <Link
                          href={`/devices/${device.id}`}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
                        >
                          Chi tiết
                          <ChevronRightIcon className="size-3.5" />
                        </Link>
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
            title="Không tìm thấy thiết bị"
            description={
              debouncedSearch || status
                ? "Thử thay đổi từ khoá hoặc bộ lọc."
                : "Thiết bị ESP32 đăng ký qua API sẽ xuất hiện tại đây."
            }
          />
        )}
      </Card>
    </>
  );
}
