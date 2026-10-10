# Skill application log (per operating rules)

- 2026-10-10 codebase-design: modules = policy, cost, sla, certificate, twin, runner-interface,
  decision-layer behind seams; adapters = SimulatedRunner vs RealNebiusRunner (two adapters = real seam).
  Depth: small interfaces (validate_proposal, evaluate_gates, build_certificate) over deep logic.
- 2026-10-10 design-taste-frontend: Design Read: "developer-certification console for AI engineers,
  warm off-white mono lab-notebook language, leaning toward bordered panels + JetBrains Mono + restrained status color."
  Screenshot overrides skill's dark-OLED suggestion (user instruction wins).
- 2026-10-10 ui-ux-pro-max: design-system query returned dark-OLED (rejected, screenshot wins);
  applied ux guidance: visible focus rings on all controls, focus never obscured, inline field errors,
  live-region on timeline polling, 44px touch targets, no emoji icons (SVG/text glyphs only).
  Stack query for polling had 0 results — using general Next.js client polling defaults, labelled fallback.
- 2026-10-10 improve-codebase-architecture: run after this batch (report to temp dir, no repo writes).
