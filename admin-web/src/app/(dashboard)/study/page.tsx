"use client";

import { useState } from "react";

import {
  BookIcon,
  ClockIcon,
  RefreshIcon,
  UsersIcon,
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
  formatDuration,
  formatNumber,
} from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type {
  AdminPlan,
  AdminSession,
  AdminStats,
  AdminUser,
  Page,
  PlanStatus,
  SessionStatus,
} from "@/lib/types";

const SESSION_LABELS: Record<SessionStatus, string> = {
  running: "Đang học",
  paused: "Tạm dừng",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
};

const SESSION_TONES: Record<SessionStatus, "emerald" | "amber" | "slate" | "rose"> = {
  running: "emerald",
  paused: "amber",
  completed: "slate",
  cancelled: "rose",
};

const PLAN_LABELS: Record<PlanStatus, string> = {
  pending: "Chờ bắt đầu",
  in_progress: "Đang thực hiện",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
};

const PLAN_TONES: Record<PlanStatus, "amber" | "sky" | "emerald" | "rose"> = {
  pending: "amber",
  in_progress: "sky",
  completed: "emerald",
  cancelled: "rose",
};

type Tab = "sessions" | "plans";

export default function StudyPage() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [sessionStatus, setSessionStatus] = useState<"" | SessionStatus>("");
  const [planStatus, setPlanStatus] = useState<"" | PlanStatus>("");
  const [userId, setUserId] = useState("");
  const [sessionPage, setSessionPage] = useState(1);
  const [planPage, setPlanPage] = useState(1);

  const stats = useApi<AdminStats>("/admin/stats");
  const users = useApi<Page<AdminUser>>("/admin/users?page_size=100");
  const sessions = useApi<Page<AdminSession>>(
    tab === "sessions"
      ? `/admin/sessions${buildQuery({
          status: sessionStatus || undefined,
          user_id: userId || undefined,
          page: sessionPage,
          page_size: 20,
        })}`
      : null,
  );
  const plans = useApi<Page<AdminPlan>>(
    tab === "plans"
      ? `/admin/plans${buildQuery({
          status: planStatus || undefined,
          user_id: userId || undefined,
          page: planPage,
          page_size: 20,
        })}`
      : null,
  );

  const reload = () => {
    stats.reload();
    users.reload();
    if (tab === "sessions") sessions.reload();
    else plans.reload();
  };

  return (
    <>
      <PageHeader
        title="Học tập"
        description="Theo dõi phiên học và kế hoạch học tập của toàn bộ người dùng."
        actions={
          <Button variant="secondary" onClick={reload} loading={stats.loading}>
            <RefreshIcon className="size-3.5" />
            Làm mới
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Phiên đang hoạt động"
          value={formatNumber(stats.data?.active_sessions ?? 0)}
          hint="Đang học hoặc tạm dừng"
          icon={<BookIcon className="size-5" />}
          tone="emerald"
        />
        <StatCard
          label="Tổng phiên học"
          value={formatNumber(stats.data?.total_sessions ?? 0)}
          icon={<ClockIcon className="size-5" />}
          tone="indigo"
        />
        <StatCard
          label="Kế hoạch học"
          value={formatNumber(stats.data?.total_plans ?? 0)}
          icon={<BookIcon className="size-5" />}
          tone="violet"
        />
        <StatCard
          label="Người dùng"
          value={formatNumber(stats.data?.total_users ?? 0)}
          icon={<UsersIcon className="size-5" />}
          tone="sky"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setTab("sessions")}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === "sessions"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Phiên học
            </button>
            <button
              type="button"
              onClick={() => setTab("plans")}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === "plans"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Kế hoạch
            </button>
          </div>

          <Select
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setSessionPage(1);
              setPlanPage(1);
            }}
            className="w-56"
            aria-label="Lọc theo người dùng"
          >
            <option value="">Tất cả người dùng</option>
            {(users.data?.items ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} · {user.email}
              </option>
            ))}
          </Select>

          {tab === "sessions" ? (
            <Select
              value={sessionStatus}
              onChange={(event) => {
                setSessionStatus(event.target.value as "" | SessionStatus);
                setSessionPage(1);
              }}
              className="w-40"
              aria-label="Lọc trạng thái phiên"
            >
              <option value="">Mọi trạng thái</option>
              <option value="running">Đang học</option>
              <option value="paused">Tạm dừng</option>
              <option value="completed">Hoàn thành</option>
              <option value="cancelled">Đã huỷ</option>
            </Select>
          ) : (
            <Select
              value={planStatus}
              onChange={(event) => {
                setPlanStatus(event.target.value as "" | PlanStatus);
                setPlanPage(1);
              }}
              className="w-44"
              aria-label="Lọc trạng thái kế hoạch"
            >
              <option value="">Mọi trạng thái</option>
              <option value="pending">Chờ bắt đầu</option>
              <option value="in_progress">Đang thực hiện</option>
              <option value="completed">Hoàn thành</option>
              <option value="cancelled">Đã huỷ</option>
            </Select>
          )}
        </div>

        {tab === "sessions" ? (
          sessions.loading && !sessions.data ? (
            <TableSkeleton rows={8} columns={6} />
          ) : sessions.error ? (
            <ErrorState message={sessions.error} onRetry={sessions.reload} />
          ) : sessions.data && sessions.data.items.length > 0 ? (
            <>
              <TableShell>
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Người học</th>
                      <th className={thClass}>Bắt đầu</th>
                      <th className={thClass}>Dự kiến</th>
                      <th className={thClass}>Thực tế</th>
                      <th className={thClass}>Trạng thái</th>
                      <th className={thClass}>Kết thúc</th>
                    </tr>
                  </thead>
                  <tbody className={tbodyClass}>
                    {sessions.data.items.map((session) => (
                      <tr key={session.id} className={trClass}>
                        <td className={tdClass}>
                          <p className="font-medium text-slate-800">{session.user_name}</p>
                          <p className="text-[11px] text-slate-400">{session.user_email}</p>
                        </td>
                        <td className={tdClass}>{formatDateTime(session.started_at)}</td>
                        <td className={tdClass}>{session.planned_minutes} phút</td>
                        <td className={tdClass}>
                          {formatDuration(session.duration_seconds)}
                        </td>
                        <td className={tdClass}>
                          <Badge tone={SESSION_TONES[session.status]}>
                            {SESSION_LABELS[session.status]}
                          </Badge>
                        </td>
                        <td className={tdClass}>{formatDateTime(session.ended_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination
                page={sessions.data.page}
                pageSize={sessions.data.page_size}
                total={sessions.data.total}
                onChange={setSessionPage}
              />
            </>
          ) : (
            <EmptyState
              title="Chưa có phiên học"
              description="Phiên học bắt đầu từ ứng dụng di động sẽ xuất hiện tại đây."
            />
          )
        ) : plans.loading && !plans.data ? (
          <TableSkeleton rows={8} columns={5} />
        ) : plans.error ? (
          <ErrorState message={plans.error} onRetry={plans.reload} />
        ) : plans.data && plans.data.items.length > 0 ? (
          <>
            <TableShell>
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className={theadClass}>
                  <tr>
                    <th className={thClass}>Người học</th>
                    <th className={thClass}>Kế hoạch</th>
                    <th className={thClass}>Bắt đầu dự kiến</th>
                    <th className={thClass}>Thời lượng</th>
                    <th className={thClass}>Trạng thái</th>
                    <th className={thClass}>Ngày tạo</th>
                  </tr>
                </thead>
                <tbody className={tbodyClass}>
                  {plans.data.items.map((plan) => (
                    <tr key={plan.id} className={trClass}>
                      <td className={tdClass}>
                        <p className="font-medium text-slate-800">{plan.user_name}</p>
                        <p className="text-[11px] text-slate-400">{plan.user_email}</p>
                      </td>
                      <td className={tdClass}>
                        <p className="font-medium text-slate-800">{plan.title}</p>
                        {plan.description ? (
                          <p className="line-clamp-1 text-[11px] text-slate-400">
                            {plan.description}
                          </p>
                        ) : null}
                      </td>
                      <td className={tdClass}>{formatDateTime(plan.scheduled_start)}</td>
                      <td className={tdClass}>{plan.planned_minutes} phút</td>
                      <td className={tdClass}>
                        <Badge tone={PLAN_TONES[plan.status]}>
                          {PLAN_LABELS[plan.status]}
                        </Badge>
                      </td>
                      <td className={tdClass}>{formatDateTime(plan.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
            <Pagination
              page={plans.data.page}
              pageSize={plans.data.page_size}
              total={plans.data.total}
              onChange={setPlanPage}
            />
          </>
        ) : (
          <EmptyState
            title="Chưa có kế hoạch"
            description="Kế hoạch học tập tạo từ ứng dụng di động sẽ xuất hiện tại đây."
          />
        )}
      </Card>
    </>
  );
}
