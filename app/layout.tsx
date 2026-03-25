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
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
