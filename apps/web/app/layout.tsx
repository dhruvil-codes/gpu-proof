import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-mono", display: "swap" });

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
  return (<html lang="en"><body className={`${sans.variable} ${mono.variable} font-sans bg-paper text-ink`}><div className="frame">{children}</div></body></html>);
}
