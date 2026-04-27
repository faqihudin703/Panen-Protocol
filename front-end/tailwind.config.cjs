/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Fraunces'", "Georgia", "serif"],
        mono:    ["'DM Mono'",  "'Courier New'", "monospace"],
        body:    ["'DM Sans'",  "sans-serif"],
      },
      colors: {
        forest: {
          950:"#0a140a",900:"#111f11",800:"#152515",
          700:"#1f351f",600:"#2d4a2d",500:"#3a5a3a",
          400:"#4a6b4a",300:"#7a9a6a",
        },
        lime:  "#a3e635",
        amber: "#d97706",
        sky:   "#38bdf8",
        bark:  "#8a9a7a",
      },
      maxWidth: {
        // Responsive content width: 100% mobile, 768px tablet, 1200px desktop, 1400px 2K
        "content": "min(92vw, 1400px)",
        "panel":   "min(96vw, 860px)",
      },
    },
  },
  plugins: [],
}