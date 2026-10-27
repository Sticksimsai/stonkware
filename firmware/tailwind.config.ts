import type { Config } from "tailwindcss";

// Firmware brand: warm CRT cream glowing on near-black, with cyan / lime / red pixel accents.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#050404",
        panel: "#0d0b09",
        raise: "#14110d",
        line: "#2a231b",
        mute: "#8c8170",
        soft: "#b3a993",
        cream: { DEFAULT: "#efe9d9", dim: "#cfc6b0" },
        cyan: { DEFAULT: "#00e8e5" },
        lime: { DEFAULT: "#e3e63d" },
        red: { DEFAULT: "#f73c4f" },
      },
      fontFamily: {
        pixel: ['"Silkscreen"', "ui-monospace", "monospace"],
        display: ['"Pixelify Sans"', '"Silkscreen"', "ui-monospace", "monospace"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],
        sans: ['"IBM Plex Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(239,233,217,.9), 0 0 18px rgba(239,233,217,.35)",
        "glow-sm": "0 0 12px rgba(239,233,217,.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
