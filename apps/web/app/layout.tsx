import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "SandboxProof — Prove model swaps in isolated sandboxes | Nebius x NVIDIA Hackathon",
  description:
    "Stop guessing if a model swap breaks tool calls. SandboxProof replays your workload in isolated Nebius Sandboxes and mints deterministic SHIP/BLOCK certificates.",
  keywords: [
    "model certification",
    "Nebius Token Factory Sandboxes",
    "NVIDIA Nemotron",
    "inference benchmarking",
    "tool calling",
    "SHIP BLOCK certificate",
  ],
  openGraph: {
    title: "SandboxProof — Prove model swaps in isolated sandboxes | Nebius x NVIDIA Hackathon",
    description:
      "Stop guessing if a model swap breaks tool calls. SandboxProof replays your workload in isolated Nebius Sandboxes and mints deterministic SHIP/BLOCK certificates.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SandboxProof — Prove model swaps in isolated sandboxes | Nebius x NVIDIA Hackathon",
    description:
      "Stop guessing if a model swap breaks tool calls. SandboxProof replays your workload in isolated Nebius Sandboxes and mints deterministic SHIP/BLOCK certificates.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className={`${mono.variable} font-mono bg-canvas text-ink`}><div className="frame">{children}</div></body></html>);
}
