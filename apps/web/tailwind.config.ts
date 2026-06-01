import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Memory-kind accent colors used across the Blueprint Board.
        working: "#38bdf8", // sky
        episodic: "#a78bfa", // violet
        semantic: "#34d399", // emerald
        procedural: "#fbbf24", // amber
      },
    },
  },
  plugins: [],
};

export default config;
