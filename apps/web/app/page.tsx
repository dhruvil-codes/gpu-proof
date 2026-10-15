"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { SiteFooter, TopNav } from "@/components/ui";
import { ScrollStack, ScrollStackItem } from "@/components/ScrollStack";
import crashwall from "@/data/crashwall.json";

const transition =
  "transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

const stackEase = "transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]";

/* ————————————————————————————————————————————————
   Isometric projection helpers.
   Every diagram on this page is a self-contained inline
   SVG drawn on a 30° axonometric grid. No external assets.
   ———————————————————————————————————————————————— */
const ISO_COS = Math.cos(Math.PI / 6); // 0.866
const ISO_SIN = 0.5;

function isoPt(x: number, y: number, z: number, u = 1): [number, number] {
  return [(x - y) * ISO_COS * u, (x + y) * ISO_SIN * u - z * u];
}

function poly(points: [number, number][]): string {
  return points.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
}

interface IsoFaces {
  top: string;
  right: string;
  front: string;
  anchors: { tr: [number, number]; tl: [number, number]; top: [number, number] };
}

function isoBox(
  cx: number,
  cy: number,
  z: number,
  w: number,
  d: number,
  h: number,
  u = 1
): IsoFaces {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - d / 2;
  const y1 = cy + d / 2;
  const at = (gx: number, gy: number, gz: number) => isoPt(gx, gy, gz, u);
  return {
    top: poly([at(x0, y0, z + h), at(x1, y0, z + h), at(x1, y1, z + h), at(x0, y1, z + h)]),
    right: poly([at(x1, y0, z + h), at(x1, y1, z + h), at(x1, y1, z), at(x1, y0, z)]),
    front: poly([at(x0, y1, z + h), at(x1, y1, z + h), at(x1, y1, z), at(x0, y1, z)]),
    anchors: {
      tr: at(x1, y0, z + h),
      tl: at(x0, y1, z + h),
      top: at(cx, cy, z + h),
    },
  };
}

/* ————————————————————————————————————————————————
   Data
   ———————————————————————————————————————————————— */

// Exploded-stack workloads (Section 2 + hero telemetry share these numbers)
const STACK_MODELS = [
  {
    id: "qwen27",
    name: "Qwen3.8 27B",
    hardware: "H100 80GB SXM5",
    capacityGb: 80,
    weightsGb: 27.8,
    precision: "FP8",
    kvGb: 14.8,
    runtimeGb: 2.0,
    totalGb: 44.6,
    tps: 94.2,
    slug: "Qwen/Qwen3.8-27B",
  },
  {
    id: "llama70",
    name: "Llama 3.3 70B",
    hardware: "H100 80GB SXM5",
    capacityGb: 80,
    weightsGb: 35.0,
    precision: "FP8",
    kvGb: 22.4,
    runtimeGb: 2.5,
    totalGb: 59.9,
    tps: 68.5,
    slug: "meta-llama/Llama-3.3-70B-Instruct",
  },
  {
    id: "ds38",
    name: "DeepSeek V4 Flash 38B",
    hardware: "L40S 48GB Ada",
    capacityGb: 48,
    weightsGb: 19.0,
    precision: "FP8",
    kvGb: 16.2,
    runtimeGb: 2.0,
    totalGb: 37.2,
    tps: 82.1,
    slug: "deepseek-ai/DeepSeek-V4-Flash",
  },
] as const;

const ECOSYSTEM = [
  {
    name: "Nebius Token Factory",
    tag: "Serverless endpoints · judge",
    badge: "Cloud Hub",
    logo: "/logos/nebius.svg",
  },
  {
    name: "NVIDIA TensorRT-LLM",
    tag: "FP8 & INT4 Kernels",
    badge: "Silicon Engine",
    logo: "/logos/nvidia.svg",
  },
  {
    name: "vLLM Serving",
    tag: "PagedAttention v0.6",
    badge: "High Throughput",
    logo: "/logos/vllm.svg",
  },
  {
    name: "Apple Silicon MLX",
    tag: "128GB Unified Memory",
    badge: "Local Inference",
    logo: "/logos/apple.svg",
  },
  {
    name: "Hugging Face Hub",
    tag: "Direct Safetensors",
    badge: "Weights Pipeline",
    logo: "/logos/huggingface.svg",
  },
  {
    name: "PyTorch 2.5",
    tag: "CUDA 12.4 Engine",
    badge: "Runtime Core",
    logo: "/logos/pytorch.svg",
  },
];

const FAILURE_MODES = [
  {
    code: "B1",
    img: "/cards/failure-b1.png",
    title: 'The "Batch-1" Illusion',
    text: "Public benchmarks test a single prompt. Five concurrent users multiply KV-cache until a 24GB card dies with CUDA OOM.",
    stat: "KV-CACHE x5 AT 5 CONCURRENT USERS",
    tag: "OOM Trap",
  },
  {
    code: "B2",
    img: "/cards/failure-b2.png",
    title: "The Hyperscaler Trap",
    text: "Most “cheap” GPU instances lock you into long contracts and idle GPU time. Nebius gives you real GPU compute on demand with no lock-in and no wasted cost.",
    stat: "FLEXIBLE GPU ACCESS WITHOUT THE TRAP",
    tag: "Trap Avoided",
  },
  {
    code: "ΣM",
    img: "/cards/failure-sigma.png",
    title: "Hallucinated Memory Math",
    text: "ChatGPT estimates miss the PyTorch allocator overhead (1.5-2.0GB) and context sequence lengths, causing production outages.",
    stat: "13.5 + 2.0 GB ≠ 30.3 GB REAL FOOTPRINT",
    tag: "Math Error",
  },
  {
    code: "PCI",
    img: "/cards/failure-pci.png",
    title: "PCIe Bus Chokepoints",
    text: "Offloading weights from VRAM to system DDR5 RAM drops token speed from 70 tok/s to 3 tok/s over x8 lanes. Silently.",
    stat: "70 tok/s → 3 tok/s OVER x8 LANES",
    tag: "Latency Cliff",
  },
  {
    code: "Q4",
    img: "/cards/failure-q4.png",
    title: "Quantization Quality Cliff",
    text: "Squashing a 70B model to 2-bit to fit one GPU degrades tool-calling accuracy by 40% versus FP8 on an L40S or H100.",
    stat: "INT2 vs FP8: -40% TOOL ACCURACY",
    tag: "Accuracy Loss",
  },
  {
    code: "TKT",
    img: "/cards/failure-tkt.png",
    title: "Quota Ticket Purgatory",
    text: "Waiting weeks for AWS GPU limit approvals versus launching high-performance Nebius compute containers in about 30 seconds.",
    stat: "WEEKS OF TICKETS → 30-SECOND LAUNCH",
    tag: "Dev Velocity",
  },
];

const PIPELINE_MODULES = [
  {
    kind: "rig" as const,
    index: "MODULE 01",
    title: "Audit Local Feasibility",
    text: "Sizing against 16-192GB Apple unified memory or multi-RTX PCIe lanes before a single dollar is spent.",
    spec: "MLX / CUDA TOPOLOGY CHECK",
    href: "/new",
    cta: "Audit your rig",
  },
  {
    kind: "blade" as const,
    index: "MODULE 02",
    title: "Spin Up the Nebius Sandbox",
    text: "One-hour hot-swappable H100 containers at $4.50/hr with live tok/s telemetry from 1 to 50+ concurrent users.",
    spec: "$4.50/HR H100 ON-DEMAND",
    href: "/new?target_gpu=h100",
    cta: "Open sandbox",
  },
  {
    kind: "cert" as const,
    index: "MODULE 03",
    title: "Mint the Production Blueprint",
    text: "A SHA-256 fingerprinted certificate with a copy-ready vllm serve command. SHIP or BLOCK, no ambiguity.",
    spec: "SHA-256 CERTIFIED",
    href: "/docs",
    cta: "See a certificate",
  },
];

const SUPPORTED_MODELS = [
  { name: "Qwen3.8", params: "27B", slug: "Qwen/Qwen3.8-27B" },
  { name: "Llama 3.3", params: "70B", slug: "meta-llama/Llama-3.3-70B-Instruct" },
  { name: "DeepSeek V4 Flash", params: "38B", slug: "deepseek-ai/DeepSeek-V4-Flash" },
  { name: "GLM-5", params: "32B", slug: "THUDM/glm-5-32b" },
  { name: "gpt-oss", params: "20B", slug: "openai/gpt-oss-20b" },
  { name: "Codestral", params: "22B", slug: "mistralai/Codestral-22B-v0.1" },
  { name: "Gemma 4", params: "31B", slug: "google/gemma-4-31b-it" },
];

/* ————————————————————————————————————————————————
   Hero: isometric hardware telemetry plane
   Local rig node → animated conduit → Nebius H100 hub
   ———————————————————————————————————————————————— */

function HeroScene() {
  const U = 24;
  const extent = 5;
  const gridAxis = Array.from({ length: extent * 2 + 1 }, (_, k) => k - extent);
  const crossPts = [-4, -2, 0, 2, 4];

  const rig = isoBox(-3, 1.6, 0, 1.8, 1.8, 0.42, U);
  const rigTop = isoBox(-3, 1.6, 0.42, 1.15, 1.15, 0.5, U);
  const hub = isoBox(0.8, -0.8, 0, 2.7, 2.7, 0.4, U);
  const die = isoBox(0.8, -0.8, 0.4, 1.6, 1.6, 0.3, U);
  const ghost1 = isoBox(3.0, 2.1, 1.8, 0.9, 0.9, 0.9, U);
  const ghost2 = isoBox(-4.4, -3.0, 1.4, 0.8, 0.8, 0.8, U);

  const rigTl = rig.anchors.tl;
  const hubRight = isoPt(2.15, -0.8, 0.3, U);

  return (
    <svg
      viewBox="0 0 640 460"
      className="block w-full"
      role="img"
      aria-label="Isometric schematic: a local Apple Silicon rig streams a model through an animated data conduit into a Nebius H100 accelerator hub, which returns a certified production blueprint."
    >
      <defs>
        <marker
          id="gp-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="5.5"
          refY="3.5"
          orient="auto"
        >
          <path d="M0 0.5 L6 3.5 L0 6.5 Z" fill="#1F1F1F" fillOpacity="0.55" />
        </marker>
      </defs>

      <g transform="translate(320 250)">
        {/* perspective grid floor */}
        {gridAxis.map((i) => (
          <g key={i}>
            <line
              x1={isoPt(i, -extent, 0, U)[0]}
              y1={isoPt(i, -extent, 0, U)[1]}
              x2={isoPt(i, extent, 0, U)[0]}
              y2={isoPt(i, extent, 0, U)[1]}
              stroke="#1F1F1F"
              strokeOpacity={Math.abs(i) === extent ? 0.3 : 0.13}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={isoPt(-extent, i, 0, U)[0]}
              y1={isoPt(-extent, i, 0, U)[1]}
              x2={isoPt(extent, i, 0, U)[0]}
              y2={isoPt(extent, i, 0, U)[1]}
              stroke="#1F1F1F"
              strokeOpacity={Math.abs(i) === extent ? 0.3 : 0.13}
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          </g>
        ))}
        {/* CAD coordinate crosses at grid intersections */}
        {crossPts.map((i) =>
          crossPts.map((j) => {
            const [px, py] = isoPt(i, j, 0, U);
            return (
              <path
                key={`${i}:${j}`}
                d={`M ${px - 3.5} ${py} H ${px + 3.5} M ${px} ${py - 3.5} V ${py + 3.5}`}
                stroke="#1F1F1F"
                strokeOpacity="0.32"
                strokeWidth="1"
              />
            );
          })
        )}

        {/* radar ring around the hub */}
        <ellipse
          cx={isoPt(0.8, -0.8, 0, U)[0]}
          cy={isoPt(0.8, -0.8, 0, U)[1]}
          rx="118"
          ry="56"
          fill="none"
          stroke="#1F1F1F"
          strokeOpacity="0.22"
          strokeWidth="1"
          strokeDasharray="4 6"
          className="gp-dash-slow"
        />

        {/* floating ghost planes */}
        <polygon points={ghost1.top} fill="none" stroke="#1F1F1F" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={ghost1.right} fill="#FFFFFF" fillOpacity="0.5" stroke="#1F1F1F" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={ghost1.front} fill="#E7E1D7" fillOpacity="0.6" stroke="#1F1F1F" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={ghost2.top} fill="none" stroke="#1F1F1F" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={ghost2.right} fill="#FFFFFF" fillOpacity="0.4" stroke="#1F1F1F" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={ghost2.front} fill="#E7E1D7" fillOpacity="0.5" stroke="#1F1F1F" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 3" />

        {/* uplink conduit: local rig → hub */}
        <path
          d="M -96 -39 C -58 -80, -16 -64, 5 -29"
          fill="none"
          stroke="#1F1F1F"
          strokeOpacity="0.18"
          strokeWidth="4"
          markerEnd="url(#gp-arrow)"
        />
        <path
          d="M -96 -39 C -58 -80, -16 -64, 5 -29"
          fill="none"
          stroke="#3B82F6"
          strokeWidth="1.75"
          className="gp-conduit"
        />

        {/* return conduit: hub → blueprint terminal */}
        <path
          d={`M ${hubRight[0]} ${hubRight[1]} C 112 18, 158 44, 152 92`}
          fill="none"
          stroke="#1F1F1F"
          strokeOpacity="0.16"
          strokeWidth="4"
          markerEnd="url(#gp-arrow)"
        />
        <path
          d={`M ${hubRight[0]} ${hubRight[1]} C 112 18, 158 44, 152 92`}
          fill="none"
          stroke="#3B82F6"
          strokeWidth="1.75"
          className="gp-conduit"
        />

        {/* local rig node */}
        <g>
          <polygon points={rig.top} fill="#FFFFFF" fillOpacity="0.92" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={rig.right} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={rig.front} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={rigTop.top} fill="#FFFFFF" fillOpacity="0.95" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={rigTop.right} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={rigTop.front} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
          <circle cx={rig.anchors.top[0] + 14} cy={rig.anchors.top[1] - 6} r="3" fill="#1E6B3A" />
          {/* leader stub toward the rig status chip */}
          <circle cx={rigTl[0]} cy={rigTl[1]} r="2.5" fill="#1F1F1F" />
          <line
            x1={rigTl[0]}
            y1={rigTl[1]}
            x2={rigTl[0] - 34}
            y2={rigTl[1] - 44}
            stroke="#1F1F1F"
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <circle cx={rigTl[0] - 34} cy={rigTl[1] - 44} r="2.5" fill="#1F1F1F" fillOpacity="0.55" />
        </g>

        {/* Nebius accelerator hub */}
        <g>
          <polygon points={hub.top} fill="#1F1F1F" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={hub.right} fill="#141414" stroke="#1F1F1F" strokeWidth="1.5" />
          <polygon points={hub.front} fill="#161616" stroke="#1F1F1F" strokeWidth="1.5" />
          {/* HBM channel traces on the substrate */}
          {[-1.35, -0.8, -0.25].map((gy) => (
            <line
              key={gy}
              x1={isoPt(-0.3, gy, 0.4, U)[0]}
              y1={isoPt(-0.3, gy, 0.4, U)[1]}
              x2={isoPt(1.9, gy, 0.4, U)[0]}
              y2={isoPt(1.9, gy, 0.4, U)[1]}
              stroke="#EFEBE4"
              strokeOpacity="0.35"
              strokeWidth="1"
            />
          ))}
          <polygon points={die.top} fill="#3B82F6" fillOpacity="0.26" stroke="#3B82F6" strokeWidth="1.5" />
          <polygon points={die.right} fill="#3B82F6" fillOpacity="0.14" stroke="#3B82F6" strokeWidth="1.5" />
          <polygon points={die.front} fill="#3B82F6" fillOpacity="0.18" stroke="#3B82F6" strokeWidth="1.5" />
        </g>
      </g>
    </svg>
  );
}

function RigStatusChip() {
  return (
    <div className="absolute left-2 top-2 hidden rounded-xl border border-ink/15 bg-white/90 px-3.5 py-2.5 shadow-[0_10px_28px_rgba(31,31,31,0.10)] backdrop-blur-sm lg:block">
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted">Local rig</p>
      <p className="mt-1 text-[11px] font-bold leading-tight">APPLE M4 MAX / RTX 4090</p>
      <p className="text-[10px] text-muted">128GB unified memory</p>
      <p className="mt-1 text-[10px] font-bold text-ship">FITS @ 4-BIT ✓</p>
    </div>
  );
}

function HubTelemetryChip() {
  return (
    <div className="hidden sm:block absolute right-2 top-2 rounded-xl border border-canvas/10 bg-ink px-4 py-3 text-canvas shadow-[0_14px_36px_rgba(31,31,31,0.28)]">
      <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-canvas/70">
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        Nebius H100 SXM5
      </div>
      <p className="mt-1.5 text-sm font-bold">30.3 GB / 80 GB</p>
      <p className="mt-0.5 text-[10px] text-canvas/70">
        94.2 tok/s&nbsp;&nbsp;&nbsp;$4.50/hr
      </p>
    </div>
  );
}

function BlueprintTerminal({
  command,
  copied,
  onCopy,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-canvas/10 bg-[#161616] text-canvas shadow-[0_18px_44px_rgba(31,31,31,0.32)]">
      <div className="flex items-center justify-between border-b border-canvas/10 px-4 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-canvas/60">
        <span>Production blueprint</span>
        <button
          type="button"
          onClick={onCopy}
          className={`${transition} cursor-pointer rounded border border-canvas/20 px-2 py-0.5 text-[9px] font-bold tracking-normal text-canvas/90 hover:border-canvas/50 hover:text-canvas`}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[10px] leading-relaxed text-canvas/90">
        <code>
          {command.split(" --").map((segment, i, all) => (
            <span key={i}>
              {i === 0 ? (
                <>
                  <span className="text-emerald-400">$</span> {segment}{" "}
                </>
              ) : (
                <>{"\n"}  {segment}</>
              )}
              {i < all.length - 1 ? "\\" : ""}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/* ————————————————————————————————————————————————
   Section 2: exploded isometric memory stack
   ———————————————————————————————————————————————— */

interface StackLayer {
  id: string;
  name: string;
}

const STACK_LAYERS: StackLayer[] = [
  { id: "weights", name: "MODEL WEIGHTS" },
  { id: "kv", name: "PAGEDATTENTION KV-CACHE" },
  { id: "compute", name: "CUDA + TENSOR CORES" },
  { id: "bus", name: "HBM3 BUS + NVLINK" },
];

function ExplodedStack({
  model,
  hover,
  onHover,
}: {
  model: (typeof STACK_MODELS)[number];
  hover: string | null;
  onHover: (id: string | null) => void;
}) {
  const U = 34;
  const gap = 0.5 + model.kvGb / 42; // separation grows with KV pressure
  const kvH = 0.28 + model.kvGb / 34; // KV slab thickness
  const wW = 2.4 + model.weightsGb / 14; // weights footprint

  const z2 = 0.5 + gap;
  const z3 = z2 + 0.45 + gap;
  const z4 = z3 + kvH + gap;

  const base = isoBox(0, 0, 0, 4.4, 4.4, 0.5, U);
  const compute = isoBox(0, 0, z2, 3.7, 3.7, 0.45, U);
  const kv = isoBox(0, 0, z3, 3.05, 3.05, kvH, U);
  const weights = isoBox(0, 0, z4, wW, wW, 0.42, U);

  const labelX = 218;

  const layerGeom = [
    {
      id: "weights",
      faces: weights,
      value: `${model.weightsGb.toFixed(1)} GB ${model.precision}`,
      hot: hover === "weights",
      topFill: "#FFFFFF",
      topOpacity: 0.96,
      sideFill: "#E7E1D7",
    },
    {
      id: "kv",
      faces: kv,
      value: `${model.kvGb.toFixed(1)} GB @ 10 USERS`,
      hot: hover === "kv",
      topFill: "#3B82F6",
      topOpacity: 0.2,
      sideFill: "#3B82F6",
    },
    {
      id: "compute",
      faces: compute,
      value: `${model.tps} tok/s`,
      hot: hover === "compute",
      topFill: "url(#gp-compute-cells)",
      topOpacity: 1,
      sideFill: "#E7E1D7",
    },
    {
      id: "bus",
      faces: base,
      value: "3.35 TB/s",
      hot: hover === "bus",
      topFill: "#1F1F1F",
      topOpacity: 1,
      sideFill: "#141414",
    },
  ];

  return (
    <svg
      viewBox="0 0 740 620"
      className="block w-full"
      role="img"
      aria-label={`Exploded isometric stack of an inference run on ${model.hardware}: model weights, KV-cache pool, compute layer, and HBM3 memory bus.`}
    >
      <defs>
        <pattern id="gp-compute-cells" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="10" fill="#FFFFFF" />
          <path d="M0 0 H10 V10" fill="none" stroke="#1F1F1F" strokeOpacity="0.28" strokeWidth="1" />
        </pattern>
      </defs>

      <g transform="translate(320 380)">
        {/* floor reference ring */}
        <ellipse
          cx="0"
          cy="0"
          rx="168"
          ry="80"
          fill="none"
          stroke="#1F1F1F"
          strokeOpacity="0.18"
          strokeWidth="1"
          strokeDasharray="3 4"
        />

        {/* key={model.id} replays the recompile animation on model switch */}
        <g key={model.id}>
          {layerGeom.map((layer, i) => {
            const dim = hover !== null && !layer.hot;
            const strokeColor = layer.hot ? "#3B82F6" : "#1F1F1F";
            const [ax, ay] = layer.faces.anchors.tr;
            return (
              <g
                key={layer.id}
                className="gp-stack-in"
                style={{ animationDelay: `${i * 70}ms` }}
                onMouseEnter={() => onHover(layer.id)}
                onMouseLeave={() => onHover(null)}
              >
                <g style={{ opacity: dim ? 0.38 : 1 }} className={stackEase}>
                  <polygon
                    points={layer.faces.top}
                    fill={layer.topFill}
                    fillOpacity={layer.topOpacity}
                    stroke={strokeColor}
                    strokeWidth="1.5"
                  />
                  <polygon
                    points={layer.faces.right}
                    fill={layer.sideFill}
                    fillOpacity={layer.id === "kv" ? 0.14 : layer.id === "bus" ? 1 : 0.9}
                    stroke={strokeColor}
                    strokeWidth="1.5"
                  />
                  <polygon
                    points={layer.faces.front}
                    fill={layer.sideFill}
                    fillOpacity={layer.id === "kv" ? 0.18 : layer.id === "bus" ? 1 : 0.9}
                    stroke={strokeColor}
                    strokeWidth="1.5"
                  />
                  {layer.id === "bus" &&
                    [-1.6, -0.9, -0.2].map((gy) => (
                      <line
                        key={gy}
                        x1={isoPt(-1.7, gy, 0.5, U)[0]}
                        y1={isoPt(-1.7, gy, 0.5, U)[1]}
                        x2={isoPt(1.7, gy, 0.5, U)[0]}
                        y2={isoPt(1.7, gy, 0.5, U)[1]}
                        stroke="#EFEBE4"
                        strokeOpacity="0.4"
                        strokeWidth="1"
                      />
                    ))}
                </g>
                {/* leader line + technical annotation */}
                <circle cx={ax} cy={ay} r="2.5" fill={layer.hot ? "#3B82F6" : "#1F1F1F"} />
                <line
                  x1={ax}
                  y1={ay}
                  x2={labelX}
                  y2={ay}
                  stroke={layer.hot ? "#3B82F6" : "#1F1F1F"}
                  strokeOpacity={layer.hot ? 0.9 : 0.4}
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text x={labelX + 8} y={ay - 6} className="fill-muted text-[9px] tracking-wide">
                  {STACK_LAYERS.find((l) => l.id === layer.id)?.name}
                </text>
                <text
                  x={labelX + 8}
                  y={ay + 12}
                  className={`text-[13px] font-bold ${layer.hot ? "fill-[#1F1F1F]" : "fill-ink"}`}
                >
                  {layer.value}
                </text>
              </g>
            );
          })}
        </g>

        {/* ground tick */}
        <path d="M -6 74 H 6 M 0 68 V 80" stroke="#1F1F1F" strokeOpacity="0.4" strokeWidth="1" />
        <text x="10" y="78" className="fill-ink/45 text-[9px]">
          {model.hardware}
        </text>
      </g>
    </svg>
  );
}

/* ————————————————————————————————————————————————
   Section 4: isometric module icons
   ———————————————————————————————————————————————— */

function ModuleIcon({ kind }: { kind: "rig" | "blade" | "cert" }) {
  const U = 20;
  return (
    <svg viewBox="0 0 160 120" className="h-24 w-auto" aria-hidden="true">
      <g transform="translate(80 66)">
        {kind === "rig" && (() => {
          const box = isoBox(0, 0, 0, 2.6, 2.6, 0.5, U);
          const [lx, ly] = isoPt(1.3, 0, 0.2, U);
          return (
            <g>
              <polygon points={box.top} fill="#FFFFFF" stroke="#1F1F1F" strokeWidth="1.5" />
              <polygon points={box.right} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
              <polygon points={box.front} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
              <circle cx={box.anchors.top[0]} cy={box.anchors.top[1]} r="3" fill="#1E6B3A" />
              <path
                d={`M ${lx} ${ly} q 18 4 26 22`}
                fill="none"
                stroke="#1F1F1F"
                strokeOpacity="0.5"
                strokeWidth="1.5"
              />
            </g>
          );
        })()}

        {kind === "blade" && (() => {
          const box = isoBox(0, 0, 0, 1.7, 1.7, 1.9, U);
          return (
            <g>
              <polygon points={box.top} fill="#FFFFFF" stroke="#1F1F1F" strokeWidth="1.5" />
              <polygon points={box.right} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
              <polygon points={box.front} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
              {[0.5, 0.95, 1.4].map((gz, i) => {
                const a = isoPt(-0.55, 0.85, gz, U);
                const b = isoPt(0.55, 0.85, gz, U);
                const led = isoPt(0.38, 0.85, gz + 0.06, U);
                return (
                  <g key={gz}>
                    <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#1F1F1F" strokeOpacity="0.45" strokeWidth="1.2" />
                    <circle cx={led[0]} cy={led[1]} r="1.7" fill={i === 0 ? "#3B82F6" : "#1F1F1F"} fillOpacity={i === 0 ? 1 : 0.35} />
                  </g>
                );
              })}
            </g>
          );
        })()}

        {kind === "cert" && (() => {
          const box = isoBox(0, 0, 0, 2.7, 2.0, 0.1, U);
          const [ccx, ccy] = isoPt(0.85, 0.62, 0.1, U);
          return (
            <g>
              <polygon points={box.top} fill="#FFFFFF" stroke="#1F1F1F" strokeWidth="1.5" />
              <polygon points={box.right} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
              <polygon points={box.front} fill="#E7E1D7" stroke="#1F1F1F" strokeWidth="1.5" />
              {[-0.45, -0.1, 0.25].map((gy) => {
                const a = isoPt(-0.95, gy, 0.1, U);
                const b = isoPt(0.55, gy, 0.1, U);
                return <line key={gy} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#1F1F1F" strokeOpacity="0.4" strokeWidth="1.2" />;
              })}
              <circle cx={ccx} cy={ccy} r="9" fill="#FFFFFF" stroke="#1E6B3A" strokeWidth="1.5" />
              <path
                d={`M ${ccx - 4} ${ccy + 0.5} l 3 3 l 5.5 -6.5`}
                fill="none"
                stroke="#1E6B3A"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
          );
        })()}
      </g>
    </svg>
  );
}

/* ————————————————————————————————————————————————
   Failure-mode isometric scenes (#dilemma chapters)
   Each scene is a small blueprint drawn for exactly
   one failure mode, reusing the axonometric helpers.
   ———————————————————————————————————————————————— */

function SceneFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 460 340"
      className="block w-full max-h-[180px] sm:max-h-[200px] mx-auto"
      role="img"
      aria-label={label}
    >
      <g transform="translate(230 186)">
        <ellipse
          cx="0"
          cy="0"
          rx="150"
          ry="70"
          fill="none"
          stroke="#1F1F1F"
          strokeOpacity="0.16"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
        {children}
      </g>
    </svg>
  );
}

function LeaderLabel({
  x,
  y,
  anchor = "start",
  lines,
}: {
  x: number;
  y: number;
  anchor?: "start" | "end";
  lines: { text: string; className: string }[];
}) {
  return (
    <text x={x} y={y} textAnchor={anchor}>
      {lines.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 13} className={l.className}>
          {l.text}
        </tspan>
      ))}
    </text>
  );
}

/* ————————————————————————————————————————————————
   Page
   ———————————————————————————————————————————————— */

type CrashEntry = {
  slug: string;
  label: string;
  paramsB: number;
  precision: string;
  gpu: string;
  gpu_vram_gb: number;
  concurrency: number;
  context_len: number;
  footprint_gb: number;
  usable_gb: number;
  verdict: "SHIP" | "BLOCK";
  one_line: string;
  surprise?: string;
};

function CrashWall() {
  const entries = (crashwall as { entries: CrashEntry[] }).entries;
  return (
    <section
      id="crash-wall"
      aria-label="Crash wall of famous model verdicts"
      className="scroll-mt-16 border-b border-ink/10 px-4 py-8 sm:px-6 sm:py-10"
    >
      <div className="mx-auto max-w-6xl">
        <p className="text-center font-mono text-[11px] font-bold uppercase tracking-widest text-muted">
          Shipped or stopped
        </p>
        <h2 className="mx-auto mt-1 max-w-xl text-center text-xl tracking-tight sm:text-2xl">
          The Crash Wall.
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-[12px] leading-relaxed text-muted">
          Famous open models, sized with the same math as the widget above —
          weights + KV-cache + 1.8 GB runtime vs 95% of VRAM. Green ships, red
          blocks. Click any card to audit it yourself.
        </p>
        <div className="mt-4 grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-4">
          {entries.map((e) => {
            const ship = e.verdict === "SHIP";
            const pct = Math.min(100, (e.footprint_gb / e.usable_gb) * 100);
            return (
              <Link
                key={e.slug}
                href={`/new?candidate_model=${encodeURIComponent(e.slug)}`}
                className="flex min-h-[44px] flex-col rounded-xl border border-ink/15 bg-[#F8F6F1] p-4 transition-all motion-safe:hover:-translate-y-0.5 hover:border-ink/40 active:scale-[0.98] motion-reduce:transition-none"
              >
                <span
                  className={`inline-block w-fit rounded px-2 py-1 font-mono text-[11px] font-bold text-white ${ship ? "bg-ship" : "bg-block"}`}
                >
                  {e.verdict}
                </span>
                <span className="mt-2 text-sm font-bold leading-snug">
                  {e.label}
                </span>
                <span className="mt-1 font-mono text-[11px] text-muted">
                  {e.gpu} · {e.precision}
                </span>
                <span className="mt-1 font-mono text-[11px] tabular-nums">
                  {e.footprint_gb.toFixed(1)} / {e.usable_gb.toFixed(1)} GB
                </span>
                <span
                  className="mt-2 h-2 overflow-hidden rounded bg-ink/10"
                  role="img"
                  aria-label={`${e.footprint_gb.toFixed(1)} GB of ${e.usable_gb.toFixed(1)} GB usable`}
                >
                  <span
                    className={`block h-full rounded ${ship ? "bg-ship" : "bg-block"}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="mt-2 text-[12px] leading-relaxed">
                  {e.one_line}
                </span>
                {e.surprise && (
                  <span className="mt-1.5 border-t border-ink/10 pt-1.5 text-[11px] leading-relaxed text-muted">
                    {e.surprise}
                  </span>
                )}
                <span className="mt-2 font-mono text-[11px] text-muted">
                  {e.concurrency} user{e.concurrency === 1 ? "" : "s"} ·{" "}
                  {e.context_len.toLocaleString()} ctx →
                </span>
              </Link>
            );
          })}
        </div>
        <p className="mt-3 text-center font-mono text-[11px] text-muted">
          weights = P × bytes (+0.35 if INT4) · KV = 2 × L × H × ctx × conc ×
          bytes / 1e9 · +1.8 runtime · usable = VRAM × 0.95 — full arithmetic in
          apps/web/data/crashwall.json
        </p>
      </div>
    </section>
  );
}

export default function Home() {
  const [stackModelId, setStackModelId] = useState<string>("qwen27");
  const [stackHover, setStackHover] = useState<string | null>(null);

  const stackModel = STACK_MODELS.find((m) => m.id === stackModelId) || STACK_MODELS[0];

  const layerRows = [
    {
      id: "weights",
      code: "L4",
      name: "Model Weights",
      value: `${stackModel.weightsGb.toFixed(1)} GB ${stackModel.precision}`,
      pct: (stackModel.weightsGb / stackModel.capacityGb) * 100,
      bar: "bg-ink",
    },
    {
      id: "kv",
      code: "L3",
      name: "PagedAttention KV-Cache",
      value: `${stackModel.kvGb.toFixed(1)} GB @ 10 users`,
      pct: (stackModel.kvGb / stackModel.capacityGb) * 100,
      bar: "bg-[#3B82F6]",
    },
    { id: "compute", code: "L2", name: "CUDA + Tensor Cores", value: `${stackModel.tps} tok/s` },
    { id: "bus", code: "L1", name: "HBM3 Bus + NVLink", value: "3.35 TB/s" },
  ];

  const weightsSeg = (stackModel.weightsGb / stackModel.capacityGb) * 100;
  const kvSeg = (stackModel.kvGb / stackModel.capacityGb) * 100;
  const runtimeSeg = (stackModel.runtimeGb / stackModel.capacityGb) * 100;
  const headroomSeg = Math.max(0, 100 - weightsSeg - kvSeg - runtimeSeg);

  return (
    <main className="bg-canvas font-mono text-ink">
      <TopNav />

      {/* ————————————————————————————————————————————————
          1. HERO: isometric hardware telemetry plane
          ———————————————————————————————————————————————— */}
      <section className="relative overflow-hidden px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:pb-24">
        <div className="mx-auto max-w-7xl">
          {/* asymmetric split: message left, enlarged isometric telemetry plane right */}
          <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-12">
            <div className="text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-ink/20 bg-white/70 px-4 py-1.5 text-[11px] font-bold tracking-tight text-ink/80 shadow-[0_2px_10px_rgba(0,0,0,0.03)] backdrop-blur-sm">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
                </span>
                Nebius Token Factory · Nemotron judge · Tavily live pricing
              </div>

              <h1 className="mt-7 text-4xl font-bold leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.35rem]">
                The Holy Grail
                <br />
                for AI Hardware.
                <span className="mt-4 block text-lg font-bold leading-snug tracking-tight text-muted lg:text-[1.35rem]">
                  From Mac Mini to 10-GPU Clusters.
                </span>
              </h1>

              <p className="mt-5 max-w-md text-xs leading-relaxed text-muted sm:text-sm">
                Stop guessing with vague ChatGPT answers. Know the exact memory,
                token speed, and production cost for any open-source model —
                measured live, before you commit budget.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/new"
                  className={`${transition} inline-flex min-h-12 cursor-pointer items-center justify-center whitespace-nowrap rounded-xl bg-ink px-6 py-3 text-xs font-bold text-canvas shadow-[0_8px_30px_rgb(0,0,0,0.1)] hover:-translate-y-0.5 hover:shadow-[0_12px_36px_rgb(0,0,0,0.16)] active:translate-y-0`}
                >
                  🚀 Launch Hardware Workbench
                  <span className="ml-2" aria-hidden="true">
                    →
                  </span>
                </Link>
                <Link
                  href="/docs"
                  className={`${transition} inline-flex min-h-12 cursor-pointer items-center justify-center whitespace-nowrap rounded-xl border border-ink/15 bg-white/75 px-6 py-3 text-xs font-bold text-ink hover:-translate-y-0.5 hover:border-ink/40 hover:bg-white active:translate-y-0`}
                >
                  📖 Read Homelab &amp; GPU Guide
                </Link>
              </div>
            </div>

            {/* Hero Isometric Hardware & Cloud Architecture Graphic (Enlarged) */}
            <div className="relative flex items-center justify-center lg:scale-105 xl:scale-110 transition-transform duration-300">
              <Image
                src="/hero-isometric.png"
                alt="GPUProof Architecture: Apple M4 Max and NVIDIA RTX 4090 local rig connecting to Nebius H100 SXM5 cloud node with production blueprint"
                width={1920}
                height={1080}
                className="h-auto w-full object-contain"
                priority
              />
            </div>
          </div>

          {/* partnership line + ecosystem strip */}
          <div className="mt-14 border-t border-ink/15 pt-8 sm:mt-16">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">
                  Certified Production Runtimes
                </p>
                <p className="mt-1 text-xs text-muted sm:text-[13px]">
                  GPUProof certifies and benchmarks against{" "}
                  <span className="font-bold text-ink">native hardware execution engines.</span>
                </p>
              </div>
              <div className="hidden sm:inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ship backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Hardware-Native Verified
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
              {ECOSYSTEM.map((item) => (
                <div
                  key={item.name}
                  className={`${transition} group flex flex-col justify-between rounded-xl border border-ink/10 bg-white/70 p-3 text-left shadow-[0_1px_4px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:border-ink/30 hover:bg-white hover:shadow-[0_8px_20px_rgba(31,31,31,0.06)]`}
                >
                  <div className="flex items-center justify-between">
                    <img src={item.logo} alt={`${item.name} logo`} loading="lazy" className="h-5 w-5 shrink-0 object-contain" />
                    <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-muted group-hover:text-ink/80">
                      {item.badge}
                    </span>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-bold leading-tight text-ink group-hover:text-black">
                      {item.name}
                    </p>
                    <p className="mt-1 text-[9px] font-medium text-muted/80">
                      {item.tag}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ————————————————————————————————————————————————
          2. EXPLODED ARCHITECTURE (#sizing)
          ———————————————————————————————————————————————— */}
      <section
        id="sizing"
        className="scroll-mt-24 border-t border-ink/15 px-4 py-16 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-6xl gp-reveal">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted">
            Physical memory hierarchy
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            The Architecture Behind Deterministic Sizing.
          </h2>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted sm:text-sm">
            Memory is not a single number. This is where every gigabyte lives in
            physical silicon, from layer weights down to the HBM3 bus. Hover a
            layer to inspect it.
          </p>

          <div className="mt-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
            {/* exploded isometric diagram */}
            <div className="rounded-3xl border border-ink/15 bg-[#F7F4EE] p-3 sm:p-4">
              <ExplodedStack model={stackModel} hover={stackHover} onHover={setStackHover} />
            </div>

            {/* interactive control panel */}
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  Explode a workload
                </p>
                <div
                  role="group"
                  aria-label="Select a model to explode"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {STACK_MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={m.id === stackModelId}
                      onClick={() => setStackModelId(m.id)}
                      className={`${transition} cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-bold ${
                        m.id === stackModelId
                          ? "border-ink bg-ink text-canvas shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
                          : "border-ink/20 bg-white/70 text-ink/80 hover:bg-white"
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col divide-y divide-ink/10 rounded-2xl border border-ink/15 bg-white">
                {layerRows.map((row) => (
                  <div
                    key={row.id}
                    onMouseEnter={() => setStackHover(row.id)}
                    onMouseLeave={() => setStackHover(null)}
                    onFocus={() => setStackHover(row.id)}
                    onBlur={() => setStackHover(null)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${row.name}: ${row.value}`}
                    className={`${transition} cursor-default px-4 py-3 ${
                      stackHover === row.id ? "bg-[#F7F4EE]" : "bg-transparent"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="flex items-center gap-2 text-xs font-bold">
                        <span className="inline-flex h-5 w-7 items-center justify-center rounded border border-ink/20 bg-canvas text-[9px]">
                          {row.code}
                        </span>
                        {row.name}
                      </p>
                      <p className="text-xs font-bold">{row.value}</p>
                    </div>
                    {row.pct !== undefined && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
                        <div
                          className={`h-full rounded-full ${row.bar} transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`}
                          style={{ width: `${row.pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* total allocation */}
              <div className="rounded-2xl border border-ink/15 bg-white p-4">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  <span>Total allocation</span>
                  <span className="rounded-full border border-ship/30 bg-ship/10 px-2 py-0.5 text-[9px] tracking-normal text-ship">
                    VERDICT: SHIP
                  </span>
                </div>
                <p className="mt-2 text-lg font-bold">
                  {stackModel.totalGb.toFixed(1)} GB{" "}
                  <span className="text-xs font-normal text-muted">
                    / {stackModel.capacityGb} GB {stackModel.hardware}
                  </span>
                </p>
                <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full border border-ink/20">
                  <div
                    className="h-full bg-ink transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ width: `${weightsSeg}%` }}
                    title={`Weights: ${stackModel.weightsGb} GB`}
                  />
                  <div
                    className="h-full bg-[#3B82F6] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ width: `${kvSeg}%` }}
                    title={`KV-Cache: ${stackModel.kvGb} GB`}
                  />
                  <div
                    className="h-full bg-amber-500 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ width: `${runtimeSeg}%` }}
                    title={`Runtime allocator: ${stackModel.runtimeGb} GB`}
                  />
                  <div className="h-full bg-white" style={{ width: `${headroomSeg}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-muted">
                  <span>WEIGHTS {stackModel.weightsGb} GB</span>
                  <span>KV {stackModel.kvGb} GB</span>
                  <span>RUNTIME {stackModel.runtimeGb} GB</span>
                  <span>HEADROOM {(stackModel.capacityGb - stackModel.totalGb).toFixed(1)} GB</span>
                </div>
              </div>

              <Link
                href={`/new?candidate_model=${encodeURIComponent(stackModel.slug)}`}
                className={`${transition} inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-ink text-xs font-bold text-canvas hover:bg-black`}
              >
                Deep-Audit {stackModel.name} →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ————————————————————————————————————————————————
          3. FAILURE MODES (#dilemma) — ScrollStack deck: cards pin
          at a fixed position and scale/dim in perfect alignment
          ———————————————————————————————————————————————— */}
      <section id="dilemma" className="scroll-mt-24 border-t border-ink/15 bg-white/30">
        <div className="mx-auto max-w-5xl px-4 pb-6 pt-16 sm:px-6 sm:pt-20">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            The AI Hardware Reality Check.
          </h2>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted">
            Leaderboards benchmark one prompt. Production serves dozens of
            users. Six failure modes that crash deployments and burn five-figure
            budgets.
          </p>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <ScrollStack
            className="mx-auto max-w-5xl"
            useWindowScroll
            smoothScroll={false}
            stackPosition={84}
            itemDistance={85}
            itemStackDistance={0}
            itemScale={0}
            baseScale={1}
            dimAmount={0}
            holdDistance={200}
          >
            {FAILURE_MODES.map((mode) => (
              <ScrollStackItem
                key={mode.code}
                itemClassName="overflow-hidden rounded-2xl border border-ink/15 bg-white shadow-[0_18px_45px_rgba(31,31,31,0.12)]"
              >
                <img
                  src={mode.img}
                  alt={`${mode.title} — ${mode.tag}`}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                {mode.code === "PCI" && (
                  <div className="border-t border-ink/10 p-5 sm:p-6">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/25 bg-canvas font-mono text-[11px] font-bold">
                        {mode.code}
                      </span>
                      <span className="rounded-full border border-ink/15 bg-canvas px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-muted">
                        {mode.tag}
                      </span>
                    </div>
                    <h3 className="mt-2.5 font-mono text-lg font-bold tracking-tight sm:text-xl">
                      {mode.title}
                    </h3>
                    <p className="mt-1.5 font-mono text-xs leading-relaxed text-muted">
                      {mode.text}
                    </p>
                    <p className="mt-3 inline-block border-l-2 border-[#3B82F6] pl-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink/70">
                      {mode.stat}
                    </p>
                  </div>
                )}
              </ScrollStackItem>
            ))}
          </ScrollStack>
        </div>
      </section>

      <CrashWall />

      {/* ————————————————————————————————————————————————
          4. HOW GPUPROOF WORKS (#how-it-works)
          ———————————————————————————————————————————————— */}
      <section
        id="how-it-works"
        className="scroll-mt-24 border-t border-ink/15 px-4 py-16 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-5xl gp-reveal">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            From Local Rig to Certified Blueprint.
          </h2>
          <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted sm:text-sm">
            Three modules, one deterministic pipeline: size locally, verify on
            Nebius, ship with cryptographic proof.
          </p>

          <div className="mt-10 grid gap-5 text-left md:grid-cols-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch lg:gap-3">
            {PIPELINE_MODULES.map((mod, i) => (
              <div key={mod.index} className="contents">
                <div
                  className={`${transition} flex flex-col rounded-2xl border border-ink/15 bg-white p-6 hover:-translate-y-1 hover:shadow-[0_14px_36px_rgba(31,31,31,0.07)]`}
                >
                  <ModuleIcon kind={mod.kind} />
                  <p className="mt-4 text-[9px] font-bold uppercase tracking-[0.22em] text-ink/45">
                    {mod.index}
                  </p>
                  <h3 className="mt-2 text-base font-bold tracking-tight">{mod.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{mod.text}</p>
                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-ink/10 pt-4">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
                      {mod.spec}
                    </span>
                    <Link
                      href={mod.href}
                      className={`${transition} shrink-0 text-[11px] font-bold underline-offset-4 hover:underline`}
                    >
                      {mod.cta} →
                    </Link>
                  </div>
                </div>
                {i < PIPELINE_MODULES.length - 1 && (
                  <div
                    aria-hidden="true"
                    className="hidden items-center justify-center text-2xl font-bold text-ink/35 lg:flex"
                  >
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>



      {/* ————————————————————————————————————————————————
          7. SUPPORTED MODELS (#models)
          ———————————————————————————————————————————————— */}
      <section
        id="models"
        className="border-t border-ink/15 bg-white/30 px-4 py-16 sm:px-6 sm:py-20"
      >
        <div className="mx-auto max-w-5xl gp-reveal text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Start With the Model You Want.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-xs text-muted">
            Click any chip to pre-fill the Hardware Workbench with a verified
            architecture.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {SUPPORTED_MODELS.map((m) => (
              <Link
                key={m.slug}
                href={`/new?candidate_model=${encodeURIComponent(m.slug)}`}
                className={`${transition} group inline-flex items-center gap-2.5 rounded-full border border-ink/20 bg-white px-4 py-2 text-xs font-bold hover:-translate-y-0.5 hover:border-ink hover:shadow-sm`}
              >
                <span>{m.name}</span>
                <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold text-canvas">
                  {m.params}
                </span>
                <span
                  aria-hidden="true"
                  className="text-ink/40 transition-transform duration-300 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ————————————————————————————————————————————————
          8. HIGH-CONTRAST CTA BANNER
          ———————————————————————————————————————————————— */}
      <section className="px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="mx-auto max-w-5xl">
          <div className="relative overflow-hidden rounded-3xl bg-ink p-8 text-canvas shadow-[0_24px_70px_rgba(31,31,31,0.28)] sm:p-14">
            {/* isometric coordinate grid */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 800 400"
              preserveAspectRatio="xMidYMid slice"
            >
              <defs>
                <pattern id="gp-iso-grid" width="56" height="32" patternUnits="userSpaceOnUse">
                  <path
                    d="M0 16 L28 0 L56 16 L28 32 Z"
                    fill="none"
                    stroke="#EFEBE4"
                    strokeOpacity="0.1"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="800" height="400" fill="url(#gp-iso-grid)" />
            </svg>

            <div className="relative lg:grid lg:grid-cols-[1.35fr_0.65fr] lg:items-center lg:gap-8">
              <div>
                <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">
                  Size Your Hardware. Benchmark in the Cloud. Deploy with Proof.
                </h2>
                <p className="mt-3 max-w-xl text-xs leading-relaxed text-canvas/70 sm:text-sm">
                  Stop overpaying legacy hyperscalers and eliminate out-of-memory
                  surprises forever.
                </p>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:flex-col lg:items-end">
                <Link
                  href="/new"
                  className={`${transition} inline-flex min-h-12 w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-xl bg-canvas px-6 py-3 text-xs font-bold text-ink hover:-translate-y-0.5 hover:bg-white active:translate-y-0 sm:w-auto`}
                >
                  🚀 Launch Hardware Workbench →
                </Link>
                <Link
                  href="/docs"
                  className={`${transition} inline-flex min-h-12 w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-xl border border-canvas/30 bg-transparent px-6 py-3 text-xs font-bold text-canvas hover:border-canvas hover:bg-canvas/10 active:translate-y-0 sm:w-auto`}
                >
                  📖 Read Homelab Handbook
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
