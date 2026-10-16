import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "SandboxProof — Autonomous GPU Inference Certification | Nebius x NVIDIA Hackathon",
  description:
    "Stop guessing if open-source models will fit in VRAM or break tool calls. Autonomously stress-test on Nebius Cloud GPUs and mint deterministic SHIP/BLOCK certificates.",
  keywords: [
    "GPU certification",
    "Nebius AI Cloud",
    "NVIDIA Nemotron",
    "vLLM",
    "inference benchmarking",
    "VRAM OOM",
    "tool calling",
    "SHIP BLOCK certificate",
  ],
  openGraph: {
    title: "SandboxProof — Autonomous GPU Inference Certification | Nebius x NVIDIA Hackathon",
    description:
      "Stop guessing if open-source models will fit in VRAM or break tool calls. Autonomously stress-test on Nebius Cloud GPUs and mint deterministic SHIP/BLOCK certificates.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SandboxProof — Autonomous GPU Inference Certification | Nebius x NVIDIA Hackathon",
    description:
      "Stop guessing if open-source models will fit in VRAM or break tool calls. Autonomously stress-test on Nebius Cloud GPUs and mint deterministic SHIP/BLOCK certificates.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className={`${mono.variable} font-mono bg-canvas text-ink`}><div className="frame">{children}</div></body></html>);
}
