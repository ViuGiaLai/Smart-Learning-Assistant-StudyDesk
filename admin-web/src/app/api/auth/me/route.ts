import { NextResponse } from "next/server";

import { backendAuthFetch } from "@/lib/backend";

export async function GET() {
  const response = await backendAuthFetch("/auth/me");

  if (!response.ok) {
    return NextResponse.json(
      { detail: response.status === 401 ? "Chưa đăng nhập" : "Không tải được hồ sơ" },
      { status: response.status },
    );
  }

  const user = await response.json();
  return NextResponse.json(user);
}
