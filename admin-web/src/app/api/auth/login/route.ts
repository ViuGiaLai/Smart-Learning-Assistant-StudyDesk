import { NextResponse } from "next/server";

import {
  backendApiUrl,
  clearSession,
  setSession,
  type TokenPair,
} from "@/lib/backend";

interface LoginBody {
  email?: string;
  password?: string;
}

interface LoginResponse {
  user?: {
    id: string;
    email: string;
    name: string;
    role: "student" | "admin";
  };
  tokens?: TokenPair | null;
  requires_email_confirmation?: boolean;
}

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ detail: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json(
      { detail: "Vui lòng nhập email và mật khẩu" },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(backendApiUrl("/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        detail:
          "Không kết nối được máy chủ API. Kiểm tra BACKEND_URL và trạng thái backend.",
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => ({}))) as LoginResponse & {
    detail?: string;
  };

  if (!upstream.ok) {
    return NextResponse.json(
      { detail: data.detail ?? "Đăng nhập thất bại" },
      { status: upstream.status },
    );
  }

  if (data.user?.role !== "admin") {
    await clearSession();
    return NextResponse.json(
      {
        detail:
          "Tài khoản này không có quyền quản trị. Dùng scripts/make_admin.py để cấp quyền admin.",
      },
      { status: 403 },
    );
  }

  if (!data.tokens?.access_token || !data.tokens.refresh_token) {
    return NextResponse.json(
      { detail: "Máy chủ không trả về phiên đăng nhập hợp lệ" },
      { status: 502 },
    );
  }

  await setSession(
    data.tokens.access_token,
    data.tokens.refresh_token,
    data.tokens.expires_in,
  );

  return NextResponse.json({
    user: data.user,
    expires_in: data.tokens.expires_in,
  });
}
