import { NextResponse, type NextRequest } from "next/server";

import { backendAuthFetch } from "@/lib/backend";

type Context = { params: Promise<{ path: string[] }> };

async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const target = `/${path.join("/")}`;
  const hasBody = !["GET", "HEAD"].includes(request.method);

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("Accept", accept);

  const init: RequestInit = {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  };

  let response: Response;
  try {
    response = await backendAuthFetch(target, init, request.nextUrl.search);
  } catch {
    return NextResponse.json(
      { detail: "Không kết nối được máy chủ API" },
      { status: 502 },
    );
  }

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const body = await response.arrayBuffer();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export function GET(request: NextRequest, context: Context) {
  return forward(request, context);
}

export function POST(request: NextRequest, context: Context) {
  return forward(request, context);
}

export function PATCH(request: NextRequest, context: Context) {
  return forward(request, context);
}

export function PUT(request: NextRequest, context: Context) {
  return forward(request, context);
}

export function DELETE(request: NextRequest, context: Context) {
  return forward(request, context);
}
