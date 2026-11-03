"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import {
  BellIcon,
  BookIcon,
  CpuIcon,
  RefreshIcon,
  TrashIcon,
} from "@/components/icons";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  StatCard,
  TableShell,
  tbodyClass,
  tdClass,
  thClass,
  theadClass,
  trClass,
} from "@/components/ui";
import { apiSend } from "@/lib/api";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  initials,
  notificationTypeLabel,
  relativeTime,
} from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AdminUser, AdminUserDetail, Role, SessionStatus } from "@/lib/types";

const SESSION_TONES: Record<SessionStatus, "emerald" | "amber" | "slate" | "rose"> = {
  running: "emerald",
  paused: "amber",
  completed: "slate",
  cancelled: "rose",
};

const SESSION_LABELS: Record<SessionStatus, string> = {
  running: "Đang học",
  paused: "Tạm dừng",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
};

function ProfileForm({
  user,
  onUpdated,
}: {
  user: AdminUser;
  onUpdated: (user: AdminUser) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [goal, setGoal] = useState(user.daily_goal_minutes);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await apiSend<AdminUser>(`/admin/users/${user.id}`, "PATCH", {
        name: name.trim(),
        role,
        daily_goal_minutes: goal,
      });
      onUpdated(updated);
      toast({ title: "Đã lưu thay đổi", tone: "success" });
    } catch (err) {
      toast({
        title: "Không lưu được",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
          <p className="truncate text-xs text-slate-400">{user.email}</p>
        </div>
      </div>

      <Field label="Tên hiển thị" htmlFor="name">
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
        />
      </Field>

      <Field label="Vai trò" htmlFor="role">
        <Select
          id="role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
        >
          <option value="student">Học viên</option>
          <option value="admin">Quản trị viên</option>
        </Select>
      </Field>

      <Field
        label="Mục tiêu học mỗi ngày (phút)"
        htmlFor="goal"
        hint="Từ 5 đến 1440 phút."
      >
        <Input
          id="goal"
          type="number"
          min={5}
          max={1440}
          value={goal}
          onChange={(event) => setGoal(Number(event.target.value))}
        />
      </Field>

      <Button className="w-full justify-center" onClick={save} loading={saving}>
        Lưu thay đổi
      </Button>

      <div className="space-y-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
        <div className="flex justify-between gap-3">
          <span>Ngày tạo</span>
          <span className="font-medium text-slate-700">
            {formatDateTime(user.created_at)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Hoạt động cuối</span>
          <span className="font-medium text-slate-700">
            {relativeTime(user.last_seen_at)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Supabase ID</span>
          <span className="max-w-[55%] truncate font-mono text-[10px] text-slate-600">
            {user.supabase_id ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const userId = params.id;

  const { data, loading, error, reload, setData } =
    useApi<AdminUserDetail>(`/admin/users/${userId}`);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!data) return;
    setDeleting(true);
    try {
      await apiSend<void>(`/admin/users/${data.user.id}`, "DELETE");
      toast({ title: "Đã xoá tài khoản", tone: "success" });
      router.push("/users");
      router.refresh();
    } catch (err) {
      toast({
        title: "Không xoá được",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading && !data) {
    return (
      <Card>
        <LoadingBlock label="Đang tải hồ sơ người dùng…" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <ErrorState message={error ?? "Không tìm thấy người dùng"} onRetry={reload} />
      </Card>
    );
  }

  const user = data.user;

  return (
    <>
      <PageHeader
        title={user.name}
        description={user.email}
        backHref="/users"
        actions={
          <Button variant="secondary" onClick={reload} loading={loading}>
            <RefreshIcon className="size-3.5" />
            Làm mới
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Thiết bị"
              value={formatNumber(user.devices_count)}
              icon={<CpuIcon className="size-5" />}
              tone="sky"
            />
            <StatCard
              label="Phiên học"
              value={formatNumber(user.sessions_count)}
              icon={<BookIcon className="size-5" />}
              tone="emerald"
            />
            <StatCard
              label="Kế hoạch"
              value={formatNumber(user.plans_count)}
              tone="violet"
            />
            <StatCard
              label="Thông báo"
              value={formatNumber(user.notifications_count)}
              icon={<BellIcon className="size-5" />}
              tone="amber"
            />
          </div>

          <Card>
            <CardHeader
              title="Thiết bị của người dùng"
              description={`${data.devices.length} thiết bị đã đăng ký.`}
            />
            {data.devices.length === 0 ? (
              <EmptyState title="Chưa có thiết bị" description="Người dùng chưa ghép ESP32 nào." />
            ) : (
              <TableShell>
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Thiết bị</th>
                      <th className={thClass}>Trạng thái</th>
                      <th className={thClass}>Lần cuối</th>
                      <th className={thClass}>Bản ghi</th>
                      <th className={thClass} />
                    </tr>
                  </thead>
                  <tbody className={tbodyClass}>
                    {data.devices.map((device) => (
                      <tr key={device.id} className={trClass}>
                        <td className={tdClass}>
                          <p className="font-medium text-slate-800">{device.name}</p>
                          <p className="font-mono text-[11px] text-slate-400">
                            {device.device_code}
                          </p>
                        </td>
                        <td className={tdClass}>
                          <Badge tone={device.online ? "emerald" : "slate"} dot>
                            {device.online ? "Online" : "Offline"}
                          </Badge>
                        </td>
                        <td className={tdClass}>{relativeTime(device.last_seen_at)}</td>
                        <td className={tdClass}>{formatNumber(device.readings_count)}</td>
                        <td className={`${tdClass} text-right`}>
                          <Link
                            href={`/devices/${device.id}`}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            Chi tiết
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Phiên học gần đây"
              description="10 phiên mới nhất của người dùng."
            />
            {data.recent_sessions.length === 0 ? (
              <EmptyState title="Chưa có phiên học" />
            ) : (
              <TableShell>
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Bắt đầu</th>
                      <th className={thClass}>Dự kiến</th>
                      <th className={thClass}>Thực tế</th>
                      <th className={thClass}>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className={tbodyClass}>
                    {data.recent_sessions.map((session) => (
                      <tr key={session.id} className={trClass}>
                        <td className={tdClass}>{formatDateTime(session.started_at)}</td>
                        <td className={tdClass}>{session.planned_minutes} phút</td>
                        <td className={tdClass}>{formatDuration(session.duration_seconds)}</td>
                        <td className={tdClass}>
                          <Badge tone={SESSION_TONES[session.status]}>
                            {SESSION_LABELS[session.status]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Thông báo gần đây"
              description="10 thông báo mới nhất."
              actions={
                <Link
                  href="/notifications"
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Quản lý
                </Link>
              }
            />
            {data.recent_notifications.length === 0 ? (
              <EmptyState title="Chưa có thông báo" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.recent_notifications.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <BellIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-800">{item.title}</p>
                        <Badge tone={item.is_read ? "slate" : "amber"}>
                          {item.is_read ? "Đã đọc" : "Chưa đọc"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                        {item.content}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {notificationTypeLabel(item.type)} · {formatDateTime(item.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Hồ sơ & phân quyền" />
            <ProfileForm
              key={user.id}
              user={user}
              onUpdated={(updated) => setData({ ...data, user: updated })}
            />
          </Card>

          <Card className="border-rose-200">
            <CardHeader
              title="Vùng nguy hiểm"
              description="Xoá tài khoản sẽ xoá toàn bộ thiết bị, dữ liệu cảm biến, phiên học và thông báo liên quan."
            />
            <div className="px-5 py-4">
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <TrashIcon className="size-4" />
                Xoá tài khoản
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá tài khoản?"
        description={`Tài khoản ${user.email} cùng toàn bộ dữ liệu liên quan sẽ bị xoá vĩnh viễn. Hành động này không thể hoàn tác.`}
        confirmLabel="Xoá vĩnh viễn"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </>
  );
}
