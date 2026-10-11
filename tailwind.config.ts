import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        rubik: ["Rubik", "Assistant", "Segoe UI", "sans-serif"],
      },
      colors: {
        ink: "#233043",
        muted: "#637083",
        mist: "#edf3f8",
      },
      boxShadow: {
        soft: "0 18px 45px rgba(49, 71, 104, 0.10)",
      },
      borderRadius: {
        soft: "1.625rem",
      },
    },
  },
  plugins: [],
};

export default config;
