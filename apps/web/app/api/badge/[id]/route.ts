import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
  const color = verdict === "SHIP" ? "#1E6B3A" : verdict === "BLOCK" ? "#B3261E" : verdict === "SIMULATED" ? "#666666" : "#1F1F1F";
  const mark = verdict === "SHIP" ? "✓" : verdict === "BLOCK" ? "✗" : "◌";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="92" role="img" aria-label="GPUProof ${esc(verdict)}: ${esc(model)}">` +
    `<rect x="0.5" y="0.5" width="339" height="91" rx="14" fill="#EFEBE4" stroke="#1F1F1F" stroke-width="1.5"/>` +
    `<rect x="14" y="14" width="86" height="26" rx="13" fill="${color}"/>` +
    `<text x="57" y="31" text-anchor="middle" font-family="monospace" font-size="13" font-weight="bold" fill="#ffffff">${mark} ${esc(verdict)}</text>` +
    `<text x="14" y="60" font-family="monospace" font-size="14" font-weight="bold" fill="#1F1F1F">${esc(model.slice(0, 30))}</text>` +
    `<text x="14" y="78" font-family="monospace" font-size="11" fill="#666666">GPUProof certified${hw ? ` · ${esc(hw)}` : ""}</text>` +
    `</svg>`;
  return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300" } });
}
