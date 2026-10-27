import type { Config } from "tailwindcss";

// Firmware brand: warm CRT cream glowing on near-black, with cyan / lime / red pixel accents.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#03050c",
        panel: "#070b16",
        raise: "#0b1222",
        line: "#1a2742",
        mute: "#6f81a8",
        soft: "#9fb0d3",
        cream: { DEFAULT: "#e8f1ff", dim: "#b9c9ea" },
        cyan: { DEFAULT: "#38d9ff" },
        lime: { DEFAULT: "#4d7cff" },
        red: { DEFAULT: "#ff4d6d" },
      },
      fontFamily: {
        pixel: ['"Silkscreen"', "ui-monospace", "monospace"],
        display: ['"Pixelify Sans"', '"Silkscreen"', "ui-monospace", "monospace"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],
        sans: ['"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(232,241,255,.9), 0 0 18px rgba(232,241,255,.35)",
        "glow-sm": "0 0 12px rgba(232,241,255,.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
