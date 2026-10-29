/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ground and surfaces
        bg: "#F1F1ED",          // chrome / page ground (warm paper)
        surface: "#FFFFFF",     // the sheet + panels
        raised: "#FAFAF7",      // subtle well inside a panel
        // Ink tiers (secondary holds 4.5:1 on both grounds)
        ink: "#131313",
        ink2: "#6B6B66",
        faint: "#A3A29B",       // placeholders / disabled only
        // Lines
        line: "#E3E2DC",        // sheet edge, card edges
        rule: "#ECEBE6",        // row rules, table dividers
        control: "#D2D1CB",     // input / select borders
        // Accent — crash-test signal orange. Graphic + large type + data hue.
        accent: "#FF4D0A",
        accentInk: "#C43A05",   // text-safe accent on white
        accentWash: "#FFE8DD",
        // Verdict semantics (pale pair + text tone per app rules)
        ship: "#247B50",
        shipWash: "#DCFAE5",
        shipDeep: "#04250E",
        block: "#B3362A",
        blockWash: "#FFEDEA",
        blockDeep: "#831C1E",
        warn: "#92400E",
        warnWash: "#FFFBEB",
        // Terminal (real code surfaces only)
        term: "#141414",
        termText: "#EDEDE8",
        termMuted: "#A6A69E",
        termRule: "#2A2A28",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      maxWidth: {
        shell: "1240px",
        measure: "680px",
      },
      borderRadius: {
        sheet: "16px",
        card: "12px",
        control: "8px",
      },
    },
  },
  plugins: [],
};
