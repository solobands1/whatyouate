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
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" }
        }
      },
      animation: {
        scan: "scan 2s ease-in-out infinite",
        shimmer: "shimmer 1.6s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
