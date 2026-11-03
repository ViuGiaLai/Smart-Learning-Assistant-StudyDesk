"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  ActivityIcon,
  BellIcon,
  ClockIcon,
  CpuIcon,
  DropletIcon,
  KeyIcon,
  MotionIcon,
  RefreshIcon,
  SendIcon,
  SunIcon,
  ThermometerIcon,
  TrashIcon,
  WifiIcon,
} from "@/components/icons";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  StatCard,
  TableShell,
  Toggle,
  tbodyClass,
  tdClass,
  thClass,
  theadClass,
  trClass,
} from "@/components/ui";
import { apiSend } from "@/lib/api";
import {
  formatDateTime,
  formatHumidity,
  formatLux,
  formatNumber,
  formatTemp,
  relativeTime,
} from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type {
  AdminCommandResult,
  AdminDeviceDetail,
  AdminDeviceKey,
  AdminReading,
  DeviceSettings,
  Page,
} from "@/lib/types";

function ReadingCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
      <span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}>
        {icon}
      </span>
      <div>
        <p className="text-[11px] font-medium text-slate-400">{label}</p>
        <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function CommandButton({
  label,
  active,
  loading,
  onClick,
}: {
  label: string;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "primary" : "secondary"}
      size="sm"
      loading={loading}
      onClick={onClick}
      className="justify-center"
    >
      {label}
    </Button>
  );
}

export default function DeviceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const deviceId = params.id;

  const { data, loading, error, reload, setData } =
    useApi<AdminDeviceDetail>(`/admin/devices/${deviceId}`);
  const [readingPage, setReadingPage] = useState(1);
  const readings = useApi<Page<AdminReading>>(
    `/admin/devices/${deviceId}/readings?page=${readingPage}&page_size=15`,
  );

  const [settingsOverride, setSettingsOverride] = useState<DeviceSettings | null>(
    null,
  );
  const settings = settingsOverride ?? data?.settings ?? null;
  const [savingSettings, setSavingSettings] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState<AdminDeviceKey | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const updateSetting = <K extends keyof DeviceSettings>(
    key: K,
    value: DeviceSettings[K],
  ) => {
    const base = settingsOverride ?? data?.settings;
    if (!base) return;
    setSettingsOverride({ ...base, [key]: value });
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const updated = await apiSend<AdminDeviceDetail>(
        `/admin/devices/${deviceId}`,
        "PATCH",
        { settings },
      );
      setData(updated);
      setSettingsOverride(null);
      toast({ title: "Đã cập nhật ngưỡng cảm biến", tone: "success" });
    } catch (err) {
      toast({
        title: "Không lưu được cấu hình",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const sendCommand = async (
    action: string,
    value: boolean | Record<string, unknown> | null,
    label: string,
  ) => {
    setCommand(`${action}:${String(value)}`);
    try {
      const result = await apiSend<AdminCommandResult>(
        `/admin/devices/${deviceId}/command`,
        "POST",
        { action, value },
      );
      toast({
        title: result.delivered ? `${label}: đã gửi lệnh` : `${label}: chưa gửi được`,
        description: result.delivered
          ? `Topic ${result.topic}`
          : result.detail ?? "MQTT chưa kết nối",
        tone: result.delivered ? "success" : "error",
      });
    } catch (err) {
      toast({
        title: "Gửi lệnh thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
    } finally {
      setCommand(null);
    }
  };

  const rotateKey = async () => {
    setRotating(true);
    try {
      const result = await apiSend<AdminDeviceKey>(
        `/admin/devices/${deviceId}/rotate-key`,
        "POST",
      );
      setNewKey(result);
      setConfirmRotate(false);
      toast({ title: "Đã tạo device key mới", tone: "success" });
    } catch (err) {
      toast({
        title: "Không tạo được key",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        tone: "error",
      });
    } finally {
      setRotating(false);
    }
  };

  const removeDevice = async () => {
    setDeleting(true);
    try {
      await apiSend<void>(`/admin/devices/${deviceId}`, "DELETE");
      toast({ title: "Đã xoá thiết bị", tone: "success" });
      router.push("/devices");
      router.refresh();
    } catch (err) {
      toast({
        title: "Không xoá được thiết bị",
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
        <LoadingBlock label="Đang tải thiết bị…" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <ErrorState message={error ?? "Không tìm thấy thiết bị"} onRetry={reload} />
      </Card>
    );
  }

  const latest = data.latest_reading;

  return (
    <>
      <PageHeader
        title={data.name}
        description={`Mã thiết bị: ${data.device_code}`}
        backHref="/devices"
        actions={
          <>
            <Button variant="secondary" onClick={reload} loading={loading}>
              <RefreshIcon className="size-3.5" />
              Làm mới
            </Button>
            <Button variant="secondary" onClick={() => setConfirmRotate(true)}>
              <KeyIcon className="size-3.5" />
              Đổi device key
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Trạng thái"
              value={data.online ? "Online" : "Offline"}
              hint={relativeTime(data.last_seen_at)}
              icon={<WifiIcon className="size-5" />}
              tone={data.online ? "emerald" : "slate"}
            />
            <StatCard
              label="Bản ghi 24h"
              value={formatNumber(data.readings_24h)}
              hint={`Tổng ${formatNumber(data.readings_count)} bản ghi`}
              icon={<ActivityIcon className="size-5" />}
              tone="violet"
            />
            <StatCard
              label="Cảnh báo 24h"
              value={formatNumber(data.alerts_24h)}
              hint={`Tổng ${formatNumber(data.notifications_count)} cảnh báo`}
              icon={<BellIcon className="size-5" />}
              tone="amber"
            />
            <StatCard
              label="Chủ sở hữu"
              value={data.owner.name}
              hint={data.owner.email}
              icon={<CpuIcon className="size-5" />}
              tone="sky"
            />
          </div>

          <Card>
            <CardHeader
              title="Dữ liệu cảm biến mới nhất"
              description={
                latest
                  ? `Ghi nhận lúc ${formatDateTime(latest.recorded_at)}`
                  : "Chưa có bản ghi nào"
              }
            />
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <ReadingCard
                label="Nhiệt độ"
                value={formatTemp(latest?.temperature)}
                icon={<ThermometerIcon className="size-5" />}
                tone="bg-rose-50 text-rose-600"
              />
              <ReadingCard
                label="Độ ẩm"
                value={formatHumidity(latest?.humidity)}
                icon={<DropletIcon className="size-5" />}
                tone="bg-sky-50 text-sky-600"
              />
              <ReadingCard
                label="Ánh sáng"
                value={formatLux(latest?.light_lux)}
                icon={<SunIcon className="size-5" />}
                tone="bg-amber-50 text-amber-600"
              />
              <ReadingCard
                label="Chuyển động"
                value={latest ? (latest.motion_detected ? "Có" : "Không") : "—"}
                icon={<MotionIcon className="size-5" />}
                tone="bg-indigo-50 text-indigo-600"
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Điều khiển thiết bị"
              description="Gửi lệnh MQTT tới ESP32. Thiết bị cần đang kết nối broker."
            />
            <div className="space-y-4 px-5 py-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                  Kiểm tra kết nối
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={command === "ping:null"}
                  onClick={() => sendCommand("ping", null, "Ping")}
                >
                  <SendIcon className="size-3.5" />
                  Gửi ping
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                    Đèn LED
                  </p>
                  <div className="flex gap-2">
                    <CommandButton
                      label="Bật"
                      active
                      loading={command === "set_led:true"}
                      onClick={() => sendCommand("set_led", true, "Bật LED")}
                    />
                    <CommandButton
                      label="Tắt"
                      active={false}
                      loading={command === "set_led:false"}
                      onClick={() => sendCommand("set_led", false, "Tắt LED")}
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                    Còi báo
                  </p>
                  <div className="flex gap-2">
                    <CommandButton
                      label="Bật"
                      active
                      loading={command === "set_buzzer:true"}
                      onClick={() => sendCommand("set_buzzer", true, "Bật còi")}
                    />
                    <CommandButton
                      label="Tắt"
                      active={false}
                      loading={command === "set_buzzer:false"}
                      onClick={() => sendCommand("set_buzzer", false, "Tắt còi")}
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                    Tự động cảnh báo
                  </p>
                  <div className="flex gap-2">
                    <CommandButton
                      label="Bật"
                      active
                      loading={command === "set_alerts:true"}
                      onClick={() => sendCommand("set_alerts", true, "Bật cảnh báo")}
                    />
                    <CommandButton
                      label="Tắt"
                      active={false}
                      loading={command === "set_alerts:false"}
                      onClick={() => sendCommand("set_alerts", false, "Tắt cảnh báo")}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Lịch sử dữ liệu cảm biến"
              description="15 bản ghi mới nhất mỗi trang."
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={readings.reload}
                  loading={readings.loading}
                >
                  <RefreshIcon className="size-3.5" />
                  Tải lại
                </Button>
              }
            />
            {readings.loading && !readings.data ? (
              <LoadingBlock />
            ) : readings.error ? (
              <ErrorState message={readings.error} onRetry={readings.reload} />
            ) : readings.data && readings.data.items.length > 0 ? (
              <>
                <TableShell>
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className={theadClass}>
                      <tr>
                        <th className={thClass}>Thời gian</th>
                        <th className={thClass}>Nhiệt độ</th>
                        <th className={thClass}>Độ ẩm</th>
                        <th className={thClass}>Ánh sáng</th>
                        <th className={thClass}>Chuyển động</th>
                      </tr>
                    </thead>
                    <tbody className={tbodyClass}>
                      {readings.data.items.map((reading) => (
                        <tr key={reading.id} className={trClass}>
                          <td className={tdClass}>{formatDateTime(reading.recorded_at)}</td>
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
                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  <span>
                    Trang {readingPage}/
                    {Math.max(1, Math.ceil(readings.data.total / readings.data.page_size))}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={readingPage <= 1}
                      onClick={() => setReadingPage((value) => value - 1)}
                    >
                      Trước
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        readingPage >=
                        Math.max(
                          1,
                          Math.ceil(readings.data.total / readings.data.page_size),
                        )
                      }
                      onClick={() => setReadingPage((value) => value + 1)}
                    >
                      Sau
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="Chưa có dữ liệu"
                description="Thiết bị gửi telemetry sẽ xuất hiện tại đây."
              />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Ngưỡng cảm biến"
              description="Áp dụng cho cảnh báo tự động và đồng bộ xuống thiết bị."
            />
            {settings ? (
              <div className="space-y-4 px-5 py-5">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Nhiệt độ thấp (°C)" htmlFor="tmin">
                    <Input
                      id="tmin"
                      type="number"
                      step="0.5"
                      value={settings.temperature_min}
                      onChange={(event) =>
                        updateSetting("temperature_min", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Nhiệt độ cao (°C)" htmlFor="tmax">
                    <Input
                      id="tmax"
                      type="number"
                      step="0.5"
                      value={settings.temperature_max}
                      onChange={(event) =>
                        updateSetting("temperature_max", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Độ ẩm thấp (%)" htmlFor="hmin">
                    <Input
                      id="hmin"
                      type="number"
                      value={settings.humidity_min}
                      onChange={(event) =>
                        updateSetting("humidity_min", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Độ ẩm cao (%)" htmlFor="hmax">
                    <Input
                      id="hmax"
                      type="number"
                      value={settings.humidity_max}
                      onChange={(event) =>
                        updateSetting("humidity_max", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Ánh sáng tối thiểu (lux)" htmlFor="lux">
                    <Input
                      id="lux"
                      type="number"
                      value={settings.light_min_lux}
                      onChange={(event) =>
                        updateSetting("light_min_lux", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Không chuyển động (phút)" htmlFor="motion">
                    <Input
                      id="motion"
                      type="number"
                      min={1}
                      max={180}
                      value={settings.no_motion_minutes}
                      onChange={(event) =>
                        updateSetting("no_motion_minutes", Number(event.target.value))
                      }
                    />
                  </Field>
                </div>

                <div className="space-y-2">
                  <Toggle
                    label="Thu thập dữ liệu"
                    description="Lưu lịch sử cảm biến vào cơ sở dữ liệu."
                    checked={settings.collection_enabled}
                    onChange={(value) => updateSetting("collection_enabled", value)}
                  />
                  <Toggle
                    label="Tự động điều khiển"
                    description="Bật LED khi có cảnh báo (cần bật cảnh báo bên dưới)."
                    checked={settings.auto_control}
                    onChange={(value) => updateSetting("auto_control", value)}
                  />
                  <Toggle
                    label="Bật cảnh báo"
                    description="Tạo thông báo, push và phản hồi LED/còi khi vượt ngưỡng."
                    checked={settings.alerts_enabled}
                    onChange={(value) => updateSetting("alerts_enabled", value)}
                  />
                </div>

                <Button
                  className="w-full justify-center"
                  onClick={saveSettings}
                  loading={savingSettings}
                >
                  Lưu cấu hình
                </Button>
              </div>
            ) : (
              <LoadingBlock />
            )}
          </Card>

          <Card>
            <CardHeader title="MQTT topics" description="Dùng cho firmware ESP32." />
            <div className="space-y-3 px-5 py-4">
              {Object.entries(data.mqtt_topics).map(([key, topic]) => (
                <div key={key}>
                  <p className="mb-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                    {key}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300">
                      {topic}
                    </code>
                    <CopyButton value={topic} label="" className="shrink-0 px-2" />
                  </div>
                </div>
              ))}
              <div className="border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <p>
                  Chủ sở hữu:{" "}
                  <Link
                    href={`/users/${data.owner.id}`}
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    {data.owner.email}
                  </Link>
                </p>
                <p className="mt-1 flex items-center gap-1">
                  <ClockIcon className="size-3" />
                  Tạo lúc {formatDateTime(data.created_at)}
                </p>
              </div>
            </div>
          </Card>

          <Card className="border-rose-200">
            <CardHeader
              title="Vùng nguy hiểm"
              description="Xoá thiết bị và toàn bộ dữ liệu cảm biến/thông báo liên quan."
            />
            <div className="px-5 py-4">
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <TrashIcon className="size-4" />
                Xoá thiết bị
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRotate}
        title="Tạo device key mới?"
        description="Key cũ sẽ ngừng hoạt động ngay lập tức. Bạn phải cập nhật firmware/config.h và nạp lại thiết bị."
        confirmLabel="Tạo key mới"
        danger={false}
        loading={rotating}
        onCancel={() => setConfirmRotate(false)}
        onConfirm={rotateKey}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Xoá thiết bị?"
        description={`Thiết bị ${data.device_code} cùng toàn bộ dữ liệu cảm biến và thông báo liên quan sẽ bị xoá vĩnh viễn.`}
        confirmLabel="Xoá vĩnh viễn"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeDevice}
      />

      <Modal
        open={Boolean(newKey)}
        onClose={() => setNewKey(null)}
        title="Device key mới"
        description="Key chỉ hiển thị một lần. Hãy lưu lại ngay."
        footer={
          <Button onClick={() => setNewKey(null)}>Đã lưu</Button>
        }
      >
        {newKey ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">
                Thiết bị {newKey.device_code}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-900 px-3 py-2.5 font-mono text-xs text-emerald-300">
                  {newKey.device_key}
                </code>
                <CopyButton value={newKey.device_key} />
              </div>
            </div>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
              {newKey.detail}
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
