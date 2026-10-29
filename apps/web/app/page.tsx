// The homepage hosts the unified 3-step Crash-Test Lab. force-dynamic keeps
// the lab server-rendered so useSearchParams prefill (candidate_model,
// target_gpu, workload …) is present in the HTML response instead of bailing
// to a Suspense fallback in the static prerender.
export const dynamic = "force-dynamic";

import LandingPage from "@/components/LandingPage";

export default function HomePage() {
  return <LandingPage />;
}
