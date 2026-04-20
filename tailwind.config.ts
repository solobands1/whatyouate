import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#6FA8FF",
          dark: "#4F88E8",
          soft: "#DDEBFF"
        },
        ink: "#1F2937",
        muted: "#6B7280",
        surface: "#F8FAFC",
        card: "#FFFFFF",
        ring: "#BBD4FF"
      },
      boxShadow: {
        card: "0 8px 24px rgba(40, 80, 140, 0.12)"
      },
      borderRadius: {
        xl: "20px",
        "2xl": "24px"
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "Segoe UI", "Helvetica", "Arial", "sans-serif"]
      },
      keyframes: {
        scan: {
          "0%, 100%": { top: "4px" },
          "50%": { top: "calc(100% - 4px)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% center" },
          "100%": { backgroundPosition: "-200% center" }
        },
        pop: {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.04)" },
          "100%": { transform: "scale(1)" }
        },
        "fade-slide-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "shimmer-sweep": {
          "0%": { transform: "translateX(-150%) skewX(-12deg)" },
          "25%": { transform: "translateX(300%) skewX(-12deg)" },
          "26%, 100%": { transform: "translateX(-150%) skewX(-12deg)" }
        },
        "nav-tap": {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(0.82)" },
          "70%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" }
        },
        wave: {
          "0%": { transform: "translateX(0) translateZ(0) scaleY(1)" },
          "50%": { transform: "translateX(-25%) translateZ(0) scaleY(0.85)" },
          "100%": { transform: "translateX(-50%) translateZ(0) scaleY(1)" }
        },
        "ripple-x": {
          "0%":   { transform: "translateX(0px)" },
          "50%":  { transform: "translateX(2px)" },
          "100%": { transform: "translateX(0px)" }
        }
      },
      animation: {
        scan: "scan 2s ease-in-out infinite",
        shimmer: "shimmer 2.5s ease-in-out infinite",
        pop: "pop 0.25s ease-out",
        "fade-slide-up": "fade-slide-up 0.35s ease-out",
        "shimmer-sweep": "shimmer-sweep 10s linear infinite",
        "nav-tap": "nav-tap 0.22s ease-out",
        wave: "wave 2.5s linear infinite",
        "ripple-x": "ripple-x 2.8s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
