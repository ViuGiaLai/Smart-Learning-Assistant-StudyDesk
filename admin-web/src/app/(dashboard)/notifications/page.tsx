"use client";

import { useState, type FormEvent } from "react";

import {
  BellIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  UsersIcon,
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
  PageHeader,
  Pagination,
  Select,
  TableShell,
  TableSkeleton,
  Textarea,
  tbodyClass,
  tdClass,
  thClass,
  theadClass,
  trClass,
} from "@/components/ui";
import { apiSend, buildQuery } from "@/lib/api";
import {
  formatDateTime,
  formatNumber,
  notificationTypeLabel,
} from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import type {
  AdminBroadcastResult,
  AdminNotification,
  AdminSendResult,
  AdminUser,
  Page,
} from "@/lib/types";

const TYPE_OPTIONS = [
  { value: "temperature_high", label: "Nhiệt độ cao" },
  { value: "temperature_low", label: "Nhiệt độ thấp" },
  { value: "humidity_high", label: "Độ ẩm cao" },
  { value: "humidity_low", label: "Độ ẩm thấp" },
  { value: "light_low", label: "Ánh sáng thấp" },
  { value: "no_motion", label: "Không chuyển động" },
  { value: "device_offline", label: "Thiết bị offline" },
  { value: "study_reminder", label: "Nhắc học" },
  { value: "study_completed", label: "Hoàn thành phiên" },
  { value: "admin_message", label: "Tin nhắn admin" },
  { value: "admin_broadcast", label: "Broadcast admin" },
];

function typeTone(type: string): "rose" | "amber" | "emerald" | "indigo" | "slate" {
  if (type.startsWith("temperature") || type.startsWith("humidity")) return "rose";
  if (type === "light_low" || type === "no_motion") return "amber";
  if (type.startsWith("study")) return "emerald";
  if (type.startsWith("admin")) return "indigo";
  return "slate";
}

function typeLabel(type: string): string {
  return notificationTypeLabel(type);
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search);

  const list = useApi<Page<AdminNotification>>(
    `/admin/notifications${buildQuery({
      search: debouncedSearch || undefined,
      type: type || undefined,
      unread_only: unread || undefined,
      page,
      page_size: 20,
    })}`,
  );
  const users = useApi<Page<AdminUser>>("/admin/users?page_size=100");

  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sendType, setSendType] = useState("admin_message");
  const [sending, setSending] = useState(false);

  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);

  const sendOne = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target) {
      toast({ title: "Chọn người nhận trước", tone: "error" });
      return;
    }
    setSending(true);
    try {
      const result = await apiSend<AdminSendResult>("/admin/notifications/send", "POST", {
        user_id: target,
        title: title.trim(),
        body: body.trim(),
        type: sendType,
      });
      toast({
        title: "Đã gửi thông báo",
        description: result.push.enabled
          ? `Push: ${result.push.sent}/${result.push.attempted} thiết bị nhận.`
          : "Đã lưu vào hộp thư. FCM chưa được cấu hình nên không gửi push.",
        tone: "success",
      });
      setTitle("");
      setBody("");
      list.reload();
    } catch (err) {
      toast({
        title: "Gửi thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
    } finally {
      setSending(false);
    }
  };

  const broadcast = async () => {
    setBroadcasting(true);
    try {
      const result = await apiSend<AdminBroadcastResult>(
        "/admin/notifications/broadcast",
        "POST",
        {
          title: broadcastTitle.trim(),
          body: broadcastBody.trim(),
          type: "admin_broadcast",
        },
      );
      toast({
        title: `Đã gửi cho ${formatNumber(result.recipients)} người`,
        description: result.push.enabled
          ? `Push: ${result.push.sent}/${result.push.attempted} thiết bị nhận.`
          : "Đã lưu vào hộp thư. FCM chưa được cấu hình nên không gửi push.",
        tone: "success",
      });
      setBroadcastTitle("");
      setBroadcastBody("");
      setConfirmBroadcast(false);
      list.reload();
    } catch (err) {
      toast({
        title: "Broadcast thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
      setConfirmBroadcast(false);
    } finally {
      setBroadcasting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Thông báo & Push"
        description="Gửi thông báo tới người dùng qua hộp thư trong ứng dụng và Firebase Cloud Messaging."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              list.reload();
              users.reload();
            }}
            loading={list.loading}
          >
            <RefreshIcon className="size-3.5" />
            Làm mới
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
            <div className="relative w-full max-w-xs">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Tìm tiêu đề hoặc nội dung…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              className="w-48"
              aria-label="Lọc theo loại"
            >
              <option value="">Mọi loại</option>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={unread}
                onChange={(event) => {
                  setUnread(event.target.checked);
                  setPage(1);
                }}
                className="size-4 cursor-pointer rounded border-slate-300 accent-indigo-600"
              />
              Chỉ chưa đọc
            </label>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
              <BellIcon className="size-4 text-slate-400" />
              {list.data ? `${formatNumber(list.data.total)} thông báo` : "Đang tải…"}
            </span>
          </div>

          {list.loading && !list.data ? (
            <TableSkeleton rows={8} columns={4} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : list.data && list.data.items.length > 0 ? (
            <>
              <TableShell>
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className={theadClass}>
                    <tr>
                      <th className={thClass}>Người nhận</th>
                      <th className={thClass}>Thông báo</th>
                      <th className={thClass}>Loại</th>
                      <th className={thClass}>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody className={tbodyClass}>
                    {list.data.items.map((item) => (
                      <tr key={item.id} className={trClass}>
                        <td className={tdClass}>
                          <p className="text-sm font-medium text-slate-800">
                            {item.user_name || "—"}
                          </p>
                          <p className="text-[11px] text-slate-400">{item.user_email}</p>
                          {item.device_code ? (
                            <p className="font-mono text-[10px] text-slate-400">
                              {item.device_code}
                            </p>
                          ) : null}
                        </td>
                        <td className={tdClass}>
                          <div className="flex items-start gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-800">{item.title}</p>
                              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                                {item.content}
                              </p>
                            </div>
                            <Badge tone={item.is_read ? "slate" : "amber"} className="shrink-0">
                              {item.is_read ? "Đã đọc" : "Mới"}
                            </Badge>
                          </div>
                        </td>
                        <td className={tdClass}>
                          <Badge tone={typeTone(item.type)}>{typeLabel(item.type)}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-500">
                          {formatDateTime(item.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
              <Pagination
                page={list.data.page}
                pageSize={list.data.page_size}
                total={list.data.total}
                onChange={setPage}
              />
            </>
          ) : (
            <EmptyState
              title="Không có thông báo"
              description="Thông báo gửi cho người dùng sẽ được lưu tại đây."
            />
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Gửi cho một người"
              description="Lưu vào hộp thư và push tới thiết bị đã đăng ký FCM."
            />
            <form onSubmit={sendOne} className="space-y-4 px-5 py-5">
              <Field label="Người nhận" htmlFor="target">
                <Select
                  id="target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  required
                >
                  <option value="">— Chọn người dùng —</option>
                  {(users.data?.items ?? []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.email}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Loại" htmlFor="send-type">
                <Select
                  id="send-type"
                  value={sendType}
                  onChange={(event) => setSendType(event.target.value)}
                >
                  <option value="admin_message">Tin nhắn admin</option>
                  <option value="study_reminder">Nhắc học</option>
                  <option value="admin_broadcast">Broadcast admin</option>
                </Select>
              </Field>
              <Field label="Tiêu đề" htmlFor="title">
                <Input
                  id="title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  placeholder="Ví dụ: Nhắc hoàn thành mục tiêu hôm nay"
                  required
                />
              </Field>
              <Field label="Nội dung" htmlFor="body">
                <Textarea
                  id="body"
                  rows={3}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={1000}
                  placeholder="Nội dung gửi tới người học…"
                  required
                />
              </Field>
              <Button type="submit" className="w-full justify-center" loading={sending}>
                <SendIcon className="size-4" />
                Gửi thông báo
              </Button>
            </form>
          </Card>

          <Card>
            <CardHeader
              title="Gửi cho tất cả"
              description="Tạo thông báo cho mọi tài khoản và push tới các thiết bị đã đăng ký."
            />
            <form
              className="space-y-4 px-5 py-5"
              onSubmit={(event) => {
                event.preventDefault();
                setConfirmBroadcast(true);
              }}
            >
              <Field label="Tiêu đề" htmlFor="broadcast-title">
                <Input
                  id="broadcast-title"
                  value={broadcastTitle}
                  onChange={(event) => setBroadcastTitle(event.target.value)}
                  maxLength={200}
                  placeholder="Ví dụ: Bảo trì hệ thống 22:00"
                  required
                />
              </Field>
              <Field label="Nội dung" htmlFor="broadcast-body">
                <Textarea
                  id="broadcast-body"
                  rows={3}
                  value={broadcastBody}
                  onChange={(event) => setBroadcastBody(event.target.value)}
                  maxLength={1000}
                  placeholder="Nội dung gửi tới toàn bộ người dùng…"
                  required
                />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <UsersIcon className="size-3.5" />
                  {formatNumber(users.data?.total ?? 0)} người nhận
                </span>
                <Button type="submit" variant="success">
                  <SendIcon className="size-4" />
                  Gửi tất cả
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmBroadcast}
        title="Gửi cho toàn bộ người dùng?"
        description={`Thông báo "${broadcastTitle}" sẽ được gửi tới ${formatNumber(
          users.data?.total ?? 0,
        )} tài khoản và push tới các thiết bị đã đăng ký.`}
        confirmLabel="Gửi ngay"
        danger={false}
        loading={broadcasting}
        onCancel={() => setConfirmBroadcast(false)}
        onConfirm={broadcast}
      />
    </>
  );
}
