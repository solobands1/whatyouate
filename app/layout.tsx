import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegister from "../components/ServiceWorkerRegister";
import Providers from "../components/Providers";

export const metadata: Metadata = {
  title: "WhatYouAte AI",
  description: "Local-first food and workout awareness with gentle guidance.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WhatYouAte AI"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#6FA8FF"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="apple-touch-icon-precomposed" href="/apple-touch-icon-precomposed.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body>
        {/* Static splash — visible immediately from raw HTML, before any JS loads */}
        <div
          id="app-splash"
          style={{
            position: "fixed", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "#F1F6FF", paddingBottom: "8rem",
            zIndex: 9999,
          }}
        >
          <style>{`
            @keyframes _sb { 0%,100%{opacity:.55;transform:scale(1)} 50%{opacity:1;transform:scale(1.04)} }
            #app-splash h1 { animation: _sb 1.8s ease-in-out infinite; font-size:1.875rem; font-weight:600; color:#1F2937; font-family:inherit; }
            #app-splash sup { font-size:10px; font-weight:600; color:rgba(31,41,55,.6); vertical-align:super; margin-left:1px; }
          `}</style>
          <h1>WhatYouAte<sup>AI</sup></h1>
        </div>
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
