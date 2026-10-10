import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = { title: "GPUProof — Make your model prove it", description: "CI/CD for AI inference. Certify candidate models on real Nebius GPUs." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className={`${mono.variable} font-mono bg-canvas text-ink`}><div className="frame">{children}</div></body></html>);
}
