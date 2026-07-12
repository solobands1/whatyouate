"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// TEMPORARY diagnostic. Renders only when the URL contains ?debug=1. Probes the network
// layer by layer with timeouts so a hang is reported instead of silently stalling. Remove
// after diagnosis.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT ${ms}ms`)), ms));
}

export default function LoadDebugOverlay() {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>(["probing…"]);

  useEffect(() => {
    setOn(typeof window !== "undefined" && /[?&]debug=1/.test(window.location.search));
  }, []);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    const out: string[] = [];
    const add = (s: string) => { out.push(s); if (alive) setLines([...out]); };

    (async () => {
      add(`env url:${SB_URL ? "ok" : "MISSING"} anon:${SB_ANON ? "ok" : "MISSING"}`);

      let token = "";
      try {
        const res = (await Promise.race([supabase.auth.getSession(), timeout(8000)])) as Awaited<
          ReturnType<typeof supabase.auth.getSession>
        >;
        token = res.data?.session?.access_token ?? "";
        add(`session: ${res.data?.session ? "yes" : "NONE"} token:${token ? token.length + "chars" : "none"}`);
      } catch (e) {
        add(`session: ${e instanceof Error ? e.message : String(e)}`);
      }

      const probe = async (label: string, url: string, headers: Record<string, string>) => {
        add(`${label}: sending…`);
        const t = Date.now();
        try {
          const res = (await Promise.race([fetch(url, { headers }), timeout(15000)])) as Response;
          const body = await res.text();
          add(`${label}: ${Date.now() - t}ms status=${res.status} len=${body.length}`);
        } catch (e) {
          add(`${label}: ${Date.now() - t}ms ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      if (SB_URL && SB_ANON) {
        await probe("health(noauth)", `${SB_URL}/auth/v1/health`, {});
        await probe("rest(anon)", `${SB_URL}/rest/v1/profiles?select=user_id&limit=1`, { apikey: SB_ANON });
        if (token) {
          await probe("rest(auth)", `${SB_URL}/rest/v1/profiles?select=user_id&limit=1`, {
            apikey: SB_ANON,
            Authorization: `Bearer ${token}`,
          });
        }
      }
      add("done");
    })();

    return () => { alive = false; };
  }, [on]);

  if (!on) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 99999,
        background: "rgba(0,0,0,0.9)",
        color: "#4ade80",
        font: "11px/1.5 ui-monospace, Menlo, monospace",
        padding: 10,
        borderRadius: 8,
        whiteSpace: "pre-wrap",
        maxHeight: "60vh",
        overflow: "auto",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
