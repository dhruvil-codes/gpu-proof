export type PassportStatus = "SHIP" | "BLOCK" | "SIMULATED";

export type PassportData = {
  model: string;
  status: PassportStatus;
  hardware: string;
  p95Ms: number | null;
  toolAccuracy: number | null;
  concurrency: number | null;
  fingerprint: string;
  label?: string;
};

export function passportShareText(data: PassportData) {
  const metrics = [
    data.p95Ms == null ? null : `P95 ${Math.round(data.p95Ms)}ms`,
    data.toolAccuracy == null ? null : `tool accuracy ${Math.round(data.toolAccuracy * 100)}%`,
    data.concurrency == null ? null : `${data.concurrency} safe streams`,
  ].filter(Boolean).join(" · ");
  return `SandboxProof ${data.status}: ${data.model} on ${data.hardware}. ${metrics}. Receipt ${data.fingerprint.slice(0, 16)}…`;
}

export function passportShareUrl(data: PassportData, certificateUrl?: string) {
  const params = new URLSearchParams({ text: passportShareText(data) });
  if (certificateUrl) params.set("url", certificateUrl);
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export async function downloadPassportPng(data: PassportData) {
  if (typeof document === "undefined") return;
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is unavailable in this browser");

  const ink = "#111111";
  const orange = "#FF4D0A";
  const muted = "#A4A49F";
  const statusColor = data.status === "SHIP" ? "#42735B" : data.status === "BLOCK" ? "#B84233" : "#A66A18";
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 1200, 630);
  ctx.strokeStyle = "#30302E";
  ctx.lineWidth = 1;
  [84, 1116].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke(); });
  [90, 520].forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); });

  ctx.fillStyle = orange;
  ctx.fillRect(106, 31, 18, 18);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 24px Inter, sans-serif";
  ctx.fillText("SANDBOXPROOF", 138, 50);
  ctx.fillStyle = muted;
  ctx.font = "500 14px 'JetBrains Mono', monospace";
  ctx.fillText("MODEL PASSPORT / VERIFIABLE RECEIPT", 710, 48);

  ctx.fillStyle = orange;
  ctx.font = "500 16px 'JetBrains Mono', monospace";
  ctx.fillText((data.label || "SANDBOX-MEASURED").toUpperCase(), 108, 135);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 52px Inter, sans-serif";
  const model = data.model.length > 33 ? `${data.model.slice(0, 32)}…` : data.model;
  ctx.fillText(model, 105, 215);
  ctx.fillStyle = statusColor;
  ctx.fillRect(106, 260, 280, 104);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "600 64px Inter, sans-serif";
  ctx.fillText(data.status, 129, 333);
  ctx.fillStyle = muted;
  ctx.font = "500 15px 'JetBrains Mono', monospace";
  ctx.fillText(`HARDWARE  ${data.hardware.toUpperCase()}`, 432, 289);
  ctx.fillText(`P95 LATENCY  ${data.p95Ms == null ? "—" : `${Math.round(data.p95Ms)} MS`}`, 432, 320);
  ctx.fillText(`TOOL ACCURACY  ${data.toolAccuracy == null ? "—" : `${Math.round(data.toolAccuracy * 100)}%`}`, 432, 351);
  ctx.fillText(`SAFE CONCURRENCY  ${data.concurrency ?? "—"}`, 432, 382);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "500 15px 'JetBrains Mono', monospace";
  ctx.fillText(`SHA-256  ${data.fingerprint.slice(0, 60)}`, 107, 561);
  ctx.fillStyle = orange;
  ctx.fillRect(106, 588, 988, 3);

  const url = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = `sandboxproof-${data.status.toLowerCase()}-${data.model.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  link.click();
}
