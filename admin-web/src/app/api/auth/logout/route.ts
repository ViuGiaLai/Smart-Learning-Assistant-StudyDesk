import { NextResponse } from "next/server";

import { clearSession } from "@/lib/backend";

export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
