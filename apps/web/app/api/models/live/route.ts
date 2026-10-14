import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const base = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  for (const k of ["sort", "direction", "limit", "search", "filter", "expand"]) {
    const v = searchParams.get(k);
    if (v) params.set(k, v);
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${base}/models/live?${params.toString()}`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (res.ok) return NextResponse.json(await res.json());
  } catch {
    /* backend unreachable */
  }
  return NextResponse.json({ ok: false }, { status: 502 });
}
