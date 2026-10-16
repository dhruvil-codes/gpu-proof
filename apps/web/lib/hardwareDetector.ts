"use client";

/**
 * SandboxProof Local Hardware Auto-Detection & System Profiler.
 *
 * Browser-native fingerprinting — zero permissions, zero downloads, <50ms.
 * Sources: WebGL WEBGL_debug_renderer_info, navigator.deviceMemory,
 * navigator.hardwareConcurrency, userAgent / userAgentData.
 *
 * Maps the raw fingerprint onto the GPU catalog keys used by
 * services/advisor.py so per-model fit math stays consistent
 * between client and server.
 */

export type DetectedOS = "macOS" | "Windows" | "Linux" | "Unknown";
export type DetectedArch = "arm64" | "x86_64" | "unknown";

export interface DetectedHardware {
  os: DetectedOS;
  arch: DetectedArch;
  gpuRenderer: string;
  gpuVendor: string;
  deviceMemoryGB?: number;
  cpuThreads?: number;
  /** GPU_CATALOG key best matching this machine (e.g. MAC_MINI_16GB, RTX4090). */
  profileKey: string;
  /** Human label, e.g. "Apple Mac Mini (Apple Silicon, ~16GB Unified Memory)". */
  label: string;
  /** Short badge line, e.g. "Apple Mac Mini · M-Series · ~16GB". */
  badge: string;
  /** Usable memory for model weights in GB (VRAM or unified). */
  usableGB: number;
  confidence: "high" | "medium" | "low";
  method: "webgl+ua" | "cli-bridge" | "fallback";
  detectedAt: number;
  durationMs: number;
}

export interface HardwareTarget {
  key: string;
  label: string;
  sub: string;
  /** Usable GB for fit math. Nebius Cloud maps to L40S 48GB entry point. */
  usableGB: number;
  kind: "auto" | "local" | "cloud";
}

/** Target selector options — mirrors services/advisor.py GPU_CATALOG. */
export const HARDWARE_TARGETS: HardwareTarget[] = [
  {
    key: "AUTO",
    label: "Current Machine (Auto-Detected)",
    sub: "Use the browser-detected profile above",
    usableGB: 0, // resolved at evaluation time to detected.usableGB
    kind: "auto",
  },
  {
    key: "MAC_MINI_16GB",
    label: "Apple Mac Mini 16GB",
    sub: "Unified memory · Ollama / MLX · 4-bit",
    usableGB: 16,
    kind: "local",
  },
  {
    key: "MAC_MINI_24GB",
    label: "Apple Mac Mini 24GB",
    sub: "Unified memory · Ollama / MLX · 4-bit",
    usableGB: 24,
    kind: "local",
  },
  {
    key: "PC_24GB",
    label: "PC Workstation 24GB RAM",
    sub: "System RAM · CPU/RAM offload · 24GB",
    usableGB: 24,
    kind: "local",
  },
  {
    key: "PC_32GB",
    label: "PC Workstation 32GB RAM",
    sub: "System RAM · CPU/RAM offload · 32GB",
    usableGB: 32,
    kind: "local",
  },
  {
    key: "RTX4090",
    label: "NVIDIA RTX 4090 24GB",
    sub: "Single consumer flagship · local dev",
    usableGB: 24,
    kind: "local",
  },
  {
    key: "RTX3090",
    label: "NVIDIA RTX 3090 24GB",
    sub: "Homelab workhorse · single 24GB",
    usableGB: 24,
    kind: "local",
  },
  {
    key: "DUAL_RTX3090",
    label: "Dual RTX 3090 48GB",
    sub: "Homelab multi-GPU · 48GB pooled",
    usableGB: 48,
    kind: "local",
  },
  {
    key: "MACBOOK_MAX_64GB",
    label: "MacBook Pro Max 64GB",
    sub: "Unified memory · mobile workstation",
    usableGB: 64,
    kind: "local",
  },
  {
    key: "MAC_STUDIO_128GB",
    label: "Mac Studio 128GB",
    sub: "Local heavy-weight · Metal / MLX",
    usableGB: 128,
    kind: "local",
  },
  {
    key: "NEBIUS_CLOUD",
    label: "Nebius Cloud GPU",
    sub: "L40S 48GB → H100 80GB certified",
    usableGB: 48,
    kind: "cloud",
  },
];

export const DETECTED_KEY = "sandboxproof-hw-detected";
export const TARGET_KEY = "sandboxproof-hw-target";
export const CLI_BRIDGE_KEY = "sandboxproof-cli-profile";
export const RAM_OVERRIDE_KEY = "sandboxproof-ram-override";

export function loadRamOverride(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const val = localStorage.getItem(RAM_OVERRIDE_KEY);
    if (!val) return null;
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function saveRamOverride(gb: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RAM_OVERRIDE_KEY, String(gb));
  } catch {
    /* ignore */
  }
}

export function clearRamOverride(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(RAM_OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Raw fingerprint helpers
// ---------------------------------------------------------------------------

function getWebGLFingerprint(): { renderer: string; vendor: string } {
  if (typeof document === "undefined") return { renderer: "", vendor: "" };
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return { renderer: "", vendor: "" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) {
      const renderer = String(
        gl.getParameter((ext as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL) ?? ""
      );
      const vendor = String(
        gl.getParameter((ext as { UNMASKED_VENDOR_WEBGL: number }).UNMASKED_VENDOR_WEBGL) ?? ""
      );
      return { renderer, vendor };
    }
    // Extension blocked (privacy-hardened browser) — fall back to bare parameter.
    return { renderer: String(gl.getParameter(gl.RENDERER) ?? ""), vendor: String(gl.getParameter(gl.VENDOR) ?? "") };
  } catch {
    return { renderer: "", vendor: "" };
  }
}

function getDeviceMemoryGB(): number | undefined {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const v = nav.deviceMemory;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    /* unavailable (Firefox/Safari) */
  }
  return undefined;
}

function getCpuThreads(): number | undefined {
  try {
    const v = navigator.hardwareConcurrency;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    /* unavailable */
  }
  return undefined;
}

function detectOS(ua: string, platform: string): DetectedOS {
  const s = `${ua} ${platform}`.toLowerCase();
  if (s.includes("mac os") || s.includes("macos") || s.includes("macintosh") || s.includes("macintel")) return "macOS";
  if (s.includes("win")) return "Windows";
  if (s.includes("linux") || s.includes("x11") || s.includes("android") || s.includes("cros")) return "Linux";
  return "Unknown";
}

function detectArch(ua: string, platform: string): DetectedArch {
  const s = `${ua} ${platform}`.toLowerCase();
  // Apple Silicon Macs report "Macintosh ... Intel" historically but expose
  // arm64 via userAgentData platform/architecture when available.
  try {
    const uad = (navigator as Navigator & { userAgentData?: { platform?: string; architecture?: string } })
      .userAgentData;
    if (uad?.architecture) {
      const a = uad.architecture.toLowerCase();
      if (a.includes("arm")) return "arm64";
      if (a.includes("x86") || a.includes("x64")) return "x86_64";
    }
    if (uad?.platform) {
      if (uad.platform.toLowerCase().includes("mac")) return "arm64";
    }
  } catch {
    /* ignore */
  }
  if (s.includes("arm") || s.includes("aarch64") || (s.includes("mac") && !s.includes("intel"))) return "arm64";
  if (s.includes("x86_64") || s.includes("x64") || s.includes("win64") || s.includes("wow64") || s.includes("intel")) {
    // Intel-string Macs on Apple Silicon are indistinguishable from UA alone;
    // default macOS desktops to arm64 (correct for all shipping Macs).
    return "x86_64";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// GPU renderer pattern matching
// ---------------------------------------------------------------------------

type GpuMatch = { profileKey: string; chip: string; usableGB: number };

function matchGpuRenderer(renderer: string): GpuMatch | null {
  const r = (renderer || "").toLowerCase();
  if (!r) return null;

  // NVIDIA discrete — most specific first.
  const nvidia = r.match(/rtx\s?(4090|4080|4070|3090|3080|3090\s?ti|4090\s?d)/);
  if (r.includes("nvidia") || r.includes("geforce") || nvidia) {
    const model = nvidia?.[1]?.replace(/\s+/g, "").toUpperCase() ?? "";
    if (model.startsWith("4090")) return { profileKey: "RTX4090", chip: "NVIDIA GeForce RTX 4090", usableGB: 24 };
    if (model.startsWith("4080")) return { profileKey: "RTX4090", chip: "NVIDIA GeForce RTX 4080", usableGB: 16 };
    if (model.startsWith("4070")) return { profileKey: "RTX4090", chip: "NVIDIA GeForce RTX 4070", usableGB: 12 };
    if (model.startsWith("3090")) return { profileKey: "RTX3090", chip: "NVIDIA GeForce RTX 3090", usableGB: 24 };
    if (model.startsWith("3080")) return { profileKey: "RTX3090", chip: "NVIDIA GeForce RTX 3080", usableGB: 10 };
    return { profileKey: "RTX4090", chip: "NVIDIA Discrete GPU", usableGB: 24 };
  }

  // Apple Silicon — ANGLE exposes "Apple GPU" / "ANGLE (Apple, ANGLE Metal
  // Renderer: Apple M3 Pro, ...)" on modern macOS Chrome/Safari.
  const appleChip = r.match(/apple\s?(m[1-4](?:\s?(?:pro|max|ultra))?)/);
  if (r.includes("apple") || r.includes("metal")) {
    const chip = appleChip ? `Apple ${appleChip[1].replace(/\s+/g, " ").trim().toUpperCase()}` : "Apple Silicon M-Series";
    return { profileKey: "", chip, usableGB: 0 }; // usableGB resolved from deviceMemory below
  }

  // AMD / Intel.
  if (r.includes("radeon") || r.includes("rx ") || r.includes("amd")) {
    const m = r.match(/rx\s?\d{3,4}/);
    return { profileKey: "RTX3090", chip: m ? `AMD Radeon ${m[0].toUpperCase()}` : "AMD Radeon", usableGB: 12 };
  }
  if (r.includes("intel")) {
    return { profileKey: "MAC_MINI_16GB", chip: "Intel Integrated Graphics", usableGB: 8 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Machine profiling — renderer + OS + memory → catalog profile
// ---------------------------------------------------------------------------

export function profileMachine(input: {
  os: DetectedOS;
  arch: DetectedArch;
  renderer: string;
  deviceMemoryGB?: number;
}): { profileKey: string; label: string; badge: string; usableGB: number; confidence: "high" | "medium" | "low" } {
  const { os, renderer, deviceMemoryGB } = input;
  const mem = deviceMemoryGB;
  const gpu = matchGpuRenderer(renderer);

  // 1. NVIDIA discrete wins wherever it appears (Windows/Linux desktops,
  //    eGPU Macs, cloud workstation browsers).
  if (gpu && (gpu.profileKey === "RTX4090" || gpu.profileKey === "RTX3090")) {
    const is4090 = gpu.profileKey === "RTX4090" && gpu.usableGB >= 16;
    const key = gpu.chip.includes("3090") ? "RTX3090" : "RTX4090";
    const vram = gpu.chip.includes("4080") ? 16 : gpu.chip.includes("3080") ? 10 : gpu.chip.includes("4070") ? 12 : 24;
    void is4090;
    return {
      profileKey: key,
      label: `${gpu.chip} (${vram}GB GDDR6X)`,
      badge: `${gpu.chip} · ${vram}GB`,
      usableGB: vram,
      confidence: "high",
    };
  }

  // 2. Apple Silicon Macs — unified memory determines the tier.
  const looksApple = os === "macOS" || (gpu !== null && gpu.profileKey === "");
  if (looksApple) {
    const chip = gpu?.chip ?? "Apple Silicon M-Series";
    if (mem !== undefined) {
      if (mem <= 16) {
        return {
          profileKey: "MAC_MINI_16GB",
          label: `Apple Mac Mini (Apple Silicon M-Series, ~16GB Unified Memory)`,
          badge: `${chip} · ~16GB Unified`,
          usableGB: 16,
          confidence: "high",
        };
      }
      if (mem <= 32) {
        return {
          profileKey: "MAC_MINI_24GB",
          label: `Apple Mac Mini / MacBook Air (Apple Silicon M-Series, ~${mem}GB Unified Memory)`,
          badge: `${chip} · ~${mem}GB Unified`,
          usableGB: mem,
          confidence: "high",
        };
      }
      if (mem <= 64) {
        return {
          profileKey: "MACBOOK_MAX_64GB",
          label: `Apple MacBook Pro Max (Apple Silicon, ~${mem}GB Unified Memory)`,
          badge: `${chip} · ~${mem}GB Unified`,
          usableGB: mem,
          confidence: "high",
        };
      }
      return {
        profileKey: "MAC_STUDIO_128GB",
        label: `Apple Mac Studio (Apple Silicon Max/Ultra, ~${mem}GB Unified Memory)`,
        badge: `${chip} · ~${mem}GB Unified`,
        usableGB: mem,
        confidence: "high",
      };
    }
    // No deviceMemory (Safari/Firefox) — sensible default that still
    // answers "will it run" for the most common Mac Mini 16GB tier.
    return {
      profileKey: "MAC_MINI_16GB",
      label: `Apple Mac (${chip}, ~16GB–24GB Unified Memory)`,
      badge: `${chip} · ~16GB Unified`,
      usableGB: 16,
      confidence: "medium",
    };
  }

  // 3. Windows / Linux without a recognized discrete GPU — use system RAM
  //    as a conservative usable-memory estimate (integrated / unknown GPU).
  if (mem !== undefined) {
    if (mem >= 48) {
      return {
        profileKey: "MACBOOK_MAX_64GB",
        label: `Linux/Windows Workstation (~${mem}GB system RAM, high-memory CPU offload capable)`,
        badge: `Workstation · ~${mem}GB RAM`,
        usableGB: mem,
        confidence: "medium",
      };
    }
    const rounded = Math.round(mem);
    const key = rounded >= 20 ? "PC_24GB" : "MAC_MINI_16GB";
    return {
      profileKey: key,
      label:
        rounded >= 20
          ? `PC Workstation (${gpu?.chip ?? "CPU/RAM Offload"}, ~${rounded}GB system RAM)`
          : `PC / Laptop (${gpu?.chip ?? "Integrated GPU"}, ~${rounded}GB system RAM)`,
      badge: `${gpu?.chip ?? "PC"} · ~${rounded}GB RAM`,
      usableGB: rounded,
      confidence: "medium",
    };
  }

  // 4. Total fallback — renderer string only, or nothing at all.
  if (gpu) {
    return {
      profileKey: gpu.profileKey || "MAC_MINI_16GB",
      label: `${gpu.chip} (memory estimate unavailable)`,
      badge: gpu.chip,
      usableGB: gpu.usableGB || 16,
      confidence: "low",
    };
  }
  return {
    profileKey: "MAC_MINI_16GB",
    label: "Unknown Machine (~16GB estimated — run `sandboxproof detect` for exact specs)",
    badge: "Unknown machine · ~16GB est.",
    usableGB: 16,
    confidence: "low",
  };
}

// ---------------------------------------------------------------------------
// Public detection entry point — synchronous, <50ms, no permissions
// ---------------------------------------------------------------------------

export function detectHardware(): DetectedHardware {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  // A fresh CLI-bridge profile (24h TTL) beats heuristics — the native probe
  // knows the exact chip name and VRAM down to the megabyte.
  try {
    const bridged = loadCliBridgeProfile();
    if (bridged) {
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      return { ...bridged, durationMs: Math.round((t1 - t0) * 10) / 10 };
    }
  } catch {
    /* fall through to browser fingerprinting */
  }

  const { renderer, vendor } = getWebGLFingerprint();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const platform = typeof navigator !== "undefined" ? (navigator as Navigator & { platform?: string }).platform || "" : "";
  const os = detectOS(ua, platform);
  const arch = detectArch(ua, platform);
  const rawDeviceMemoryGB = getDeviceMemoryGB();
  const ramOverride = loadRamOverride();
  const deviceMemoryGB = ramOverride ?? rawDeviceMemoryGB;
  const cpuThreads = getCpuThreads();

  const profiled = profileMachine({ os, arch, renderer, deviceMemoryGB });

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const detected: DetectedHardware = {
    os,
    arch,
    gpuRenderer: renderer || "(renderer hidden by browser privacy settings)",
    gpuVendor: vendor || "",
    deviceMemoryGB,
    cpuThreads,
    profileKey: profiled.profileKey,
    label: profiled.label,
    badge: profiled.badge,
    usableGB: profiled.usableGB,
    confidence: profiled.confidence,
    method: ramOverride ? "cli-bridge" : "webgl+ua",
    detectedAt: Date.now(),
    durationMs: Math.round((t1 - t0) * 10) / 10,
  };
  try {
    persistDetected(detected);
  } catch {
    /* storage unavailable (private mode) — detection still works in-memory */
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Persistence + CLI bridge
// ---------------------------------------------------------------------------

export function persistDetected(d: DetectedHardware): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DETECTED_KEY, JSON.stringify(d));
}

export function loadDetected(): DetectedHardware | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DETECTED_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as DetectedHardware;
    if (!d || !d.profileKey || !d.label) return null;
    return d;
  } catch {
    return null;
  }
}

export interface CliBridgeProfile {
  os: DetectedOS;
  chip?: string;
  gpu_name?: string;
  vram_mb?: number;
  system_ram_gb?: number;
  cpu_threads?: number;
  profileKey: string;
  label: string;
  usableGB: number;
  emitted_at?: number;
}

/**
 * Import a JSON blob emitted by `python -m services.detector` (pasted by
 * the user or posted by a local bridge) and promote it to the detected
 * profile. Returns the promoted DetectedHardware.
 */
export function importCliProfile(json: string | CliBridgeProfile): DetectedHardware {
  const obj: CliBridgeProfile = typeof json === "string" ? (JSON.parse(json) as CliBridgeProfile) : json;
  if (!obj || !obj.profileKey) throw new Error("Invalid hardware profile JSON — expected {profileKey, label, usableGB}.");
  const ramOverride = loadRamOverride();
  const effectiveGB = ramOverride ?? Number(obj.usableGB) ?? 16;
  const detected: DetectedHardware = {
    os: obj.os ?? "Unknown",
    arch: "unknown",
    gpuRenderer: obj.gpu_name ?? obj.chip ?? "",
    gpuVendor: "",
    deviceMemoryGB: obj.system_ram_gb ?? effectiveGB,
    cpuThreads: obj.cpu_threads,
    profileKey: effectiveGB === 24 ? "PC_24GB" : obj.profileKey,
    label: ramOverride
      ? `PC Workstation (${effectiveGB}GB system RAM, CPU/RAM offload capable)`
      : (obj.label || obj.profileKey),
    badge: obj.gpu_name || obj.chip || `${effectiveGB}GB RAM`,
    usableGB: effectiveGB,
    confidence: "high",
    method: "cli-bridge",
    detectedAt: Date.now(),
    durationMs: 0,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(CLI_BRIDGE_KEY, JSON.stringify({ ...obj, emitted_at: Date.now() }));
      persistDetected(detected);
    } catch {
      /* ignore */
    }
  }
  return detected;
}

function loadCliBridgeProfile(): DetectedHardware | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CLI_BRIDGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as CliBridgeProfile & { emitted_at?: number };
    if (!obj || !obj.profileKey) return null;
    // 24h TTL — stale native probes should not shadow fresh browser state.
    if (obj.emitted_at && Date.now() - obj.emitted_at > 24 * 3600 * 1000) return null;
    const ramOverride = loadRamOverride();
    const effectiveGB = ramOverride ?? Number(obj.usableGB) ?? 16;
    return {
      os: obj.os ?? "Unknown",
      arch: "unknown",
      gpuRenderer: obj.gpu_name ?? obj.chip ?? "",
      gpuVendor: "",
      deviceMemoryGB: obj.system_ram_gb ?? effectiveGB,
      cpuThreads: obj.cpu_threads,
      profileKey: effectiveGB === 24 ? "PC_24GB" : obj.profileKey,
      label: ramOverride
        ? `PC Workstation (${effectiveGB}GB system RAM, CPU/RAM offload capable)`
        : (obj.label || obj.profileKey),
      badge: obj.gpu_name || obj.chip || `${effectiveGB}GB RAM`,
      usableGB: effectiveGB,
      confidence: "high",
      method: "cli-bridge",
      detectedAt: obj.emitted_at ?? Date.now(),
      durationMs: 0,
    };
  } catch {
    return null;
  }
}

/** Asynchronously probe local FastAPI server for exact physical RAM & GPU specs. */
export async function fetchNativeHardwareProfile(): Promise<DetectedHardware | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/system/hardware", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.profileKey || typeof data.usableGB !== "number") return null;
    return importCliProfile(data);
  } catch {
    return null;
  }
}

/** Lock in a specific RAM size (e.g. 24GB) and update the local machine profile. */
export function applyRamSelection(gb: number, current: DetectedHardware | null): DetectedHardware {
  saveRamOverride(gb);
  const base: DetectedHardware = current || {
    os: "Windows",
    arch: "x86_64",
    gpuRenderer: "CPU/RAM Offload",
    gpuVendor: "",
    deviceMemoryGB: gb,
    cpuThreads: 8,
    profileKey: gb === 24 ? "PC_24GB" : gb <= 16 ? "MAC_MINI_16GB" : "MACBOOK_MAX_64GB",
    label: `PC Workstation (${gb}GB system RAM, CPU/RAM offload capable)`,
    badge: `PC · ${gb}GB RAM`,
    usableGB: gb,
    confidence: "high",
    method: "cli-bridge",
    detectedAt: Date.now(),
    durationMs: 0,
  };
  const updated: DetectedHardware = {
    ...base,
    deviceMemoryGB: gb,
    usableGB: gb,
    profileKey: gb === 24 ? "PC_24GB" : gb <= 16 ? "MAC_MINI_16GB" : "MACBOOK_MAX_64GB",
    label: `PC Workstation (${gb}GB system RAM, CPU/RAM offload capable)`,
    badge: `PC · ${gb}GB RAM`,
    confidence: "high",
    method: "cli-bridge",
  };
  persistDetected(updated);
  return updated;
}

export function getTargetKey(): string {
  if (typeof window === "undefined") return "AUTO";
  try {
    return localStorage.getItem(TARGET_KEY) || "AUTO";
  } catch {
    return "AUTO";
  }
}

export function setTargetKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TARGET_KEY, key);
  } catch {
    /* ignore */
  }
}

/** Resolve a target key to usable GB (AUTO → detected machine). */
export function resolveTargetGB(targetKey: string, detected: DetectedHardware | null): number {
  if (targetKey === "AUTO" || !targetKey) return detected?.usableGB ?? 16;
  const t = HARDWARE_TARGETS.find((x) => x.key === targetKey);
  if (t) {
    if (t.key === "AUTO") return detected?.usableGB ?? 16;
    return t.usableGB;
  }
  return detected?.usableGB ?? 16;
}

export function targetLabel(targetKey: string, detected: DetectedHardware | null): string {
  if (targetKey === "AUTO" || !targetKey) return detected ? `Your machine — ${detected.label}` : "Your machine (auto-detect…)";
  const t = HARDWARE_TARGETS.find((x) => x.key === targetKey);
  if (t?.kind === "cloud") return "Nebius Cloud GPU (L40S 48GB entry → H100 on OOM)";
  return t ? t.label : targetKey;
}

// ---------------------------------------------------------------------------
// Per-model fit evaluation against a target
// ---------------------------------------------------------------------------

export interface ModelFitLike {
  display_name?: string;
  params_b?: number;
  total_local_int4_gb?: number;
  weights_int4_gb?: number;
  local_verdict?: string;
  hardware_matrix?: { gpu_key: string; fit_status: string; fit_label: string }[];
}

export interface FitVerdict {
  fits: boolean;
  neededGB: number;
  usableGB: number;
  headroomGB: number;
  headline: string;
  detail: string;
  stackHint: string;
}

const FIT_OK = new Set(["NATIVE_FP16", "QUANTIZED_FP8", "QUANTIZED_INT4"]);

/** Answer "Can your current detected machine run this model?" */
export function evaluateFit(
  model: ModelFitLike | null | undefined,
  targetKey: string,
  detected: DetectedHardware | null
): FitVerdict | null {
  if (!model || typeof model.total_local_int4_gb !== "number") return null;
  const needed = model.total_local_int4_gb;
  const usable = resolveTargetGB(targetKey, detected);
  const usable95 = usable * 0.95;
  const headroom = Math.round((usable95 - needed) * 10) / 10;
  const isAuto = targetKey === "AUTO" || !targetKey;
  const where = isAuto ? (detected ? detected.badge : "your machine") : (targetLabel(targetKey, detected) ?? targetKey);
  const modelName = model.display_name || "This model";

  // Prefer the server-computed matrix status when the target maps to a
  // catalog key — it accounts for FP16/FP8/KV-cache tiers, not just INT4.
  let matrixStatus: string | undefined;
  const matrixKey = isAuto ? detected?.profileKey : targetKey === "NEBIUS_CLOUD" ? "L40S" : targetKey;
  if (matrixKey && Array.isArray(model.hardware_matrix)) {
    matrixStatus = model.hardware_matrix.find((h) => h.gpu_key === matrixKey)?.fit_status;
  }
  const fits = matrixStatus ? FIT_OK.has(matrixStatus) : needed <= usable95;

  if (fits) {
    return {
      fits: true,
      neededGB: needed,
      usableGB: usable,
      headroomGB: headroom,
      headline: `✅ FITS ON YOUR ${isAuto ? "DETECTED " : ""}${where.toUpperCase()}`,
      detail: `${modelName} runs at 4-bit via 'ollama pull' (~${needed}GB needed, ${headroom}GB headroom remaining).`,
      stackHint: "Local toolchain: ollama pull / MLX",
    };
  }
  // OOM branch — route to cloud when the model dwarfs local hardware.
  const params = typeof model.params_b === "number" ? ` (${model.params_b}B params)` : "";
  const cloud = needed > 130 || headroom < -100;
  return {
    fits: false,
    neededGB: needed,
    usableGB: usable,
    headroomGB: headroom,
    headline: `❌ OOM ON YOUR ${isAuto ? "CURRENT " : ""}${where.toUpperCase()}`,
    detail: `${modelName}${params} needs ~${needed}GB at 4-bit but ${where} offers ~${usable}GB. ${
      cloud
        ? "Requires multi-GPU cluster — certify on Nebius Cloud GPUs below."
        : "Exceeds local headroom — certify on Nebius Cloud GPUs below."
    }`,
    stackHint: "Production path: vLLM / SGLang on Nebius Cloud",
  };
}
