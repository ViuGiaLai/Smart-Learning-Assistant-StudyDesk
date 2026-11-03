"use client";

import { useId } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

export interface ChartPoint {
  label: string;
  value: number;
}

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

function buildPath(points: Array<{ x: number; y: number }>, close: boolean) {
  if (points.length === 0) return "";
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  if (!close) return line;
  const first = points[0];
  const last = points[points.length - 1];
  const baseline = HEIGHT - PAD.bottom;
  return `${line} L${last.x},${baseline} L${first.x},${baseline} Z`;
}

export function AreaChart({
  data,
  color = "#4f46e5",
  suffix = "",
  height = 240,
  className,
}: {
  data: ChartPoint[];
  color?: string;
  suffix?: string;
  height?: number;
  className?: string;
}) {
  const gradientId = useId().replace(/[:]/g, "");
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const rawMax = Math.max(...data.map((point) => point.value), 0);
  const step = rawMax <= 5 ? 1 : rawMax <= 20 ? 5 : rawMax <= 100 ? 20 : Math.ceil(rawMax / 4);
  const max = Math.max(step, Math.ceil((rawMax || 1) / step) * step);
  const ticks = Array.from({ length: 5 }, (_, index) => (max / 4) * index);

  const points = data.map((point, index) => ({
    x:
      PAD.left +
      (data.length <= 1 ? innerWidth / 2 : (innerWidth / (data.length - 1)) * index),
    y: PAD.top + innerHeight - (point.value / max) * innerHeight,
  }));

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ height }}
        className="w-full"
        role="img"
        aria-label="Biểu đồ dữ liệu"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => {
          const y = PAD.top + innerHeight - (tick / max) * innerHeight;
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray={tick === 0 ? undefined : "3 5"}
              />
              <text
                x={PAD.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400"
                fontSize="11"
              >
                {formatNumber(Math.round(tick))}
              </text>
            </g>
          );
        })}

        {data.length > 0 ? (
          <>
            <path d={buildPath(points, true)} fill={`url(#${gradientId})`} />
            <path
              d={buildPath(points, false)}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((point, index) => (
              <g key={`${data[index].label}-${index}`}>
                <circle cx={point.x} cy={point.y} r="8" fill="transparent">
                  <title>{`${data[index].label}: ${formatNumber(data[index].value)}${suffix}`}</title>
                </circle>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="3.2"
                  fill="#fff"
                  stroke={color}
                  strokeWidth="2"
                />
              </g>
            ))}
          </>
        ) : (
          <text
            x={WIDTH / 2}
            y={HEIGHT / 2}
            textAnchor="middle"
            className="fill-slate-400"
            fontSize="12"
          >
            Chưa có dữ liệu
          </text>
        )}

        {data.map((point, index) => (
          <text
            key={`${point.label}-${index}`}
            x={points[index].x}
            y={HEIGHT - 8}
            textAnchor="middle"
            className="fill-slate-400"
            fontSize="11"
          >
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function BarList({
  items,
  tone = "indigo",
  emptyLabel = "Chưa có dữ liệu",
}: {
  items: Array<{ label: string; count: number }>;
  tone?: "indigo" | "rose" | "emerald" | "amber";
  emptyLabel?: string;
}) {
  const max = Math.max(...items.map((item) => item.count), 1);
  const colors = {
    indigo: "bg-indigo-500",
    rose: "bg-rose-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  };

  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-xs text-slate-400">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3 px-5 py-4">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-medium text-slate-600">{item.label}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {formatNumber(item.count)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full transition-all", colors[tone])}
              style={{ width: `${Math.max(3, (item.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
