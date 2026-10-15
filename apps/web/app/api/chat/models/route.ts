import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const base = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${base}/chat/models`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (res.ok) return NextResponse.json(await res.json());
  } catch {
    /* backend unreachable */
  }
  return NextResponse.json({ models: [] }, { status: 502 });
}
