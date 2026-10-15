import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function proxy(path: string) {
  const base = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (res.ok) return NextResponse.json(await res.json());
  } catch {
    /* backend unreachable */
  }
  return NextResponse.json({ ok: false }, { status: 502 });
}

export async function GET() {
  return proxy("/matrix");
}
