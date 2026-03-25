"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";

export default function AuthGate({ children }: { children: ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#F1F6FF]">
        <Image
          src="/icon-192.png"
          alt="WhatYouAte"
          width={80}
          height={80}
          className="rounded-2xl animate-splash-breathe"
          priority
        />
      </div>
    );
  }

  return children;
}
