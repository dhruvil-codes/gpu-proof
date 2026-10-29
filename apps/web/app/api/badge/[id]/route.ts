import { NextResponse } from "next/server";

export const runtime = "nodejs";

/* Badge palette mirrors the design system (paper ground, ink text, verdict tones). */
const BG = "#F1F1ED";
const INK = "#131313";
const MUTED = "#6B6B66";
const VERDICT: Record<string, string> = {
  SHIP: "#247B50",
  BLOCK: "#B3362A",
  SIMULATED: "#6B6B66",
  PENDING: "#131313",
  UNKNOWN: "#6B6B66",
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const base = process.env.NEXT_PUBLIC_API || "http://localhost:8000";
  let verdict = "PENDING";
  let model = "model";
  let hw = "";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${base}/certifications/${params.id}/certificate`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (res.ok) {
      const j = await res.json();
      verdict = String(j.verdict || "PENDING").toUpperCase();
      model = String(j.candidate_model || j.deployment?.candidate_model || "model").split("/").pop() || "model";
      const dep = j.deployment || {};
      const gpu = String(dep.gpu_type || "");
      const prec = String(dep.precision || "");
      hw = [gpu, prec].filter(Boolean).join(" · ");
    }
  } catch {
    verdict = "UNKNOWN";
  }
  const color = VERDICT[verdict] ?? INK;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="92" role="img" aria-label="SandboxProof ${esc(verdict)}: ${esc(model)}">` +
    `<rect x="0.5" y="0.5" width="339" height="91" rx="12" fill="${BG}" stroke="${INK}" stroke-width="1"/>` +
    `<rect x="14" y="12" width="10" height="10" fill="#FF4D0A"/>` +
    `<rect x="14" y="30" width="86" height="24" rx="12" fill="${color}"/>` +
    `<text x="57" y="46" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12.5" font-weight="bold" fill="#ffffff">${esc(verdict)}</text>` +
    `<text x="14" y="70" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="bold" fill="${INK}">${esc(model.slice(0, 30))}</text>` +
    `<text x="14" y="84" font-family="Arial, Helvetica, sans-serif" font-size="10.5" fill="${MUTED}">SandboxProof certified${hw ? ` · ${esc(hw)}` : ""}</text>` +
    `</svg>`;
  return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" } });
}
