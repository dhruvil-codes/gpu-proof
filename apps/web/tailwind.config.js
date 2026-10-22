/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F6F6F2", canvas: "#F6F6F2", white: "#FFFFFF",
        ink: "#111111", inkSoft: "#1B1B1A", muted: "#777874",
        inverseMuted: "#A4A49F", rule: "#DEDFDA", darkRule: "#30302E",
        orange: "#FF4D0A", orangeWash: "#F8E0D7", orangeDeep: "#D93C00",
        ship: "#42735B", warning: "#A66A18", block: "#B84233",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "monospace"],
      },
      maxWidth: { wide: "1280px", content: "1120px" },
      borderRadius: { sm: "2px", DEFAULT: "2px", md: "2px", lg: "2px", xl: "2px", "2xl": "2px" },
    },
  },
  plugins: [],
};
