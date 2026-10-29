import type { Metadata } from "next";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Display face: Gambarino (Fontshare, OFL-equivalent licence) — the certificate face.
   Self-hosted so the build never depends on a CDN. */
const display = localFont({
  src: "./fonts/Gambarino-400.woff2",
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const sans = localFont({
  src: [
    { path: "./fonts/GeneralSans-400.woff2", weight: "400" },
    { path: "./fonts/GeneralSans-500.woff2", weight: "500" },
    { path: "./fonts/GeneralSans-600.woff2", weight: "600" },
  ],
  variable: "--font-sans",
  display: "swap",
});

/* Mono is reserved for real code: telemetry, IDs, commands, digests. */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

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
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="bg-bg text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
