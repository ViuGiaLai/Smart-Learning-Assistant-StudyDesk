"use client";

import Link from "next/link";
import { useState } from "react";

import {
  ChevronRightIcon,
  RefreshIcon,
  SearchIcon,
  UsersIcon,
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
import { formatDateTime, formatNumber, initials, relativeTime } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import type { AdminUser, Page, Role } from "@/lib/types";

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  const path = `/admin/users${buildQuery({
    search: debouncedSearch || undefined,
    role: role || undefined,
    page,
    page_size: 20,
  })}`;

  const { data, loading, error, reload } =
    useApi<Page<AdminUser>>(path);

  return (
    <>
      <PageHeader
        title="Người dùng"
        description="Quản lý tài khoản, phân quyền quản trị và theo dõi hoạt động học tập."
        actions={
          <>
            <Button variant="secondary" onClick={reload} loading={loading}>
              <RefreshIcon className="size-3.5" />
              Làm mới
            </Button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Tìm theo tên hoặc email…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as "" | Role);
              setPage(1);
            }}
            className="w-full sm:w-44"
            aria-label="Lọc theo vai trò"
          >
            <option value="">Tất cả vai trò</option>
            <option value="admin">Quản trị viên</option>
            <option value="student">Học viên</option>
          </Select>
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <UsersIcon className="size-4 text-slate-400" />
            {data ? (
              <>
                <span className="font-semibold text-slate-800">
                  {formatNumber(data.total)}
                </span>
                tài khoản
              </>
            ) : (
              "Đang tải…"
            )}
          </div>
        </div>

        {loading && !data ? (
          <TableSkeleton rows={8} columns={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data && data.items.length > 0 ? (
          <>
            <TableShell>
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Người dùng</th>
                    <th className={thClass}>Vai trò</th>
                    <th className={thClass}>Thiết bị</th>
                    <th className={thClass}>Phiên học</th>
                    <th className={thClass}>Kế hoạch</th>
                    <th className={thClass}>Hoạt động gần nhất</th>
                    <th className={thClass}>Ngày tạo</th>
                    <th className={thClass} />
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {data.items.map((user) => (
                    <tr key={user.id} className={trClass}>
                      <td className={tdClass}>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-700">
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
                      <td className={tdClass}>{formatNumber(user.sessions_count)}</td>
                      <td className={tdClass}>{formatNumber(user.plans_count)}</td>
                      <td className={tdClass}>
                        <span title={formatDateTime(user.last_seen_at)}>
                          {relativeTime(user.last_seen_at)}
                        </span>
                      </td>
                      <td className={tdClass}>{formatDateTime(user.created_at)}</td>
                      <td className={`${tdClass} text-right`}>
                        <Link
                          href={`/users/${user.id}`}
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
            title="Không tìm thấy người dùng"
            description={
              debouncedSearch || role
                ? "Thử thay đổi từ khoá hoặc bộ lọc."
                : "Người dùng đăng ký từ ứng dụng di động sẽ xuất hiện tại đây."
            }
          />
        )}
      </Card>
    </>
  );
}
