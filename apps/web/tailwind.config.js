/** @type {import('tailwindcss').Config} */
module.exports = {content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {extend: {colors: {canvas: "#EFEBE4", ink: "#1F1F1F", muted: "#666666", ship: "#1E6B3A", block: "#B3261E"},
    fontFamily: {mono: ["var(--font-geist-mono)", "JetBrains Mono", "Space Mono", "monospace"]}}}};
