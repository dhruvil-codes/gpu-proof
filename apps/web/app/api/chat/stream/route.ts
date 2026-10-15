import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const base = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  try {
    const body = await req.text();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const upstream = await fetch(`${base}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    if (!upstream.ok || !upstream.body) {
      clearTimeout(timer);
      let detail = `upstream ${upstream.status}`;
      try {
        const j = await upstream.json();
        if (j?.detail) detail = String(j.detail);
      } catch {
        /* keep status */
      }
      return NextResponse.json({ detail }, { status: upstream.status || 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ detail: "chat proxy unreachable" }, { status: 502 });
  }
}
