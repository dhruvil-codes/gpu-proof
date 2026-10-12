"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  candidate?: string;
  source?: string;
};

const QUICK_PROMPTS = [
  "Can I run gpt-oss-20b on my 16GB Mac Mini?",
  "What hardware does Qwen 3.6 27B need on a single RTX 4090?",
  "Will DeepSeek V4 Pro fit on an L40S or OOM?",
  "Can Llama 4 Scout handle 10M context on a single H100?",
  "DeepSeek V4 (MIT) vs Llama 4 (Meta): which license is cleaner for enterprise?",
];

const WELCOME: ChatMsg = {
  role: "assistant",
  text: "Tell me any model you saw on Hugging Face or Twitter — I'll size its weights + KV cache and tell you which GPU tier fits before you migrate.",
  source: "deterministic",
};

export default function ModelAdvisorDrawer({
  open,
  onClose,
  initialQuery = "",
}: {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading, open]);

  useEffect(() => {
    if (initialQuery) setInput(initialQuery);
  }, [initialQuery]);

  async function ask(query: string) {
    const q = query.trim();
    if (!q || loading) return;
    setError("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error(`advisor failed: ${res.status}`);
      const j = await res.json();
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: j.answer || "No sizing available — try naming a model and GPU.",
          candidate: j.candidate_model,
          source: j.source,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Sizing service is unreachable right now. Try again, or jump straight to a live audit from /new.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="advisor-title"
      aria-describedby="advisor-subtitle"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-ink bg-[#F5F1E9] shadow-[-6px_0_0_rgba(31,31,31,0.25)]">
        <div className="flex items-start justify-between gap-3 border-b border-ink bg-ink p-4 text-canvas">
          <div>
            <h2 id="advisor-title" className="text-sm font-bold tracking-tight">
              🤖 NVIDIA Nemotron Model Migration Advisor
            </h2>
            <p id="advisor-subtitle" className="mt-1 text-[11px] leading-relaxed text-canvas/70">
              Ask whether any new model on Hugging Face or Twitter fits your GPU hardware before
              migrating.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Model Advisor"
            className="shrink-0 cursor-pointer rounded border border-canvas/40 px-2 py-1 text-xs font-bold hover:bg-canvas hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-ink/20 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Try one tap</p>
          <div className="mt-2 flex flex-col gap-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={loading}
                onClick={() => ask(p)}
                className="min-h-[44px] cursor-pointer rounded-lg border border-ink bg-canvas px-3 py-2 text-left text-[12px] font-bold transition-all hover:-translate-y-px hover:shadow-[3px_3px_0_#1F1F1F] disabled:opacity-60"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-full whitespace-pre-wrap rounded-lg border p-3 text-left text-[12px] leading-relaxed ${
                  m.role === "user"
                    ? "border-ink bg-ink text-canvas"
                    : "border-ink bg-canvas text-ink"
                }`}
              >
                {m.text}
              </div>
              {m.role === "assistant" && m.candidate && (
                <div className="mt-2 text-left">
                  <Link
                    href={`/new?candidate_model=${encodeURIComponent(m.candidate)}`}
                    onClick={onClose}
                    aria-label={`Test ${m.candidate} on GPUProof`}
                    className="btn-dark inline-block min-h-[44px] cursor-pointer rounded-lg px-4 py-2 text-xs font-bold transition-all hover:-translate-y-px"
                  >
                    🚀 Test this model on GPUProof →
                  </Link>
                  {m.source && (
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      via {m.source === "nemotron-ultra" ? "Nemotron Ultra + deterministic math" : "deterministic hardware math"} · {m.candidate}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[11px] italic text-muted">
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-emerald-600" />
              <span>Sizing VRAM + KV cache…</span>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[11px] font-bold text-block">
              {error}
            </p>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="border-t border-ink p-3"
        >
          <label htmlFor="advisor-input" className="sr-only">
            Ask about a model and GPU
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="advisor-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Can I run Gemma 2 27B on an L40S?"
              className="min-h-[44px] w-full rounded border border-ink bg-transparent px-3 text-sm outline-none placeholder:text-muted/70 focus:border-black"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="btn-dark min-h-[44px] shrink-0 cursor-pointer rounded px-4 py-2 text-sm font-bold disabled:opacity-50"
            >
              Ask →
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

/** Self-contained floating button + drawer for pages that want a persistent FAB. */
export function ModelAdvisorFab() {
  const [open, setOpen] = useState(false);
  if (open) return <ModelAdvisorDrawer open={open} onClose={() => setOpen(false)} />;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Ask the NVIDIA Nemotron Model Migration Advisor"
      aria-haspopup="dialog"
      className="fixed bottom-5 right-5 z-[90] min-h-[48px] cursor-pointer rounded-full border border-ink bg-ink px-5 py-3 text-sm font-bold text-canvas shadow-[4px_4px_0_rgba(31,31,31,0.35)] transition-all hover:-translate-y-px"
    >
      🤖 Ask Model Advisor
    </button>
  );
}
