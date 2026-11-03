import { Suspense } from "react";

import { LoadingBlock } from "@/components/ui";

import UserDetail from "./user-detail";

// useParams() chỉ biết giá trị khi chạy, nên phần chi tiết được stream
// sau khi khung trang tĩnh đã render (Cache Components).
export const instant = false;

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <LoadingBlock label="Đang tải hồ sơ người dùng…" />
        </div>
      }
    >
      <UserDetail />
    </Suspense>
  );
}
