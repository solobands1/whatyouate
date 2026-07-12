"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "./AuthProvider";

// TEMPORARY diagnostic. Renders only when the URL contains ?debug=1. Runs raw Supabase
// probes and prints session + per-query status/errors on screen, so we can see why data
// won't load on a specific device without needing a desktop Web Inspector. Remove after.
export default function LoadDebugOverlay() {
  const { user } = useAuth();
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>(["probing…"]);

  useEffect(() => {
    setOn(typeof window !== "undefined" && /[?&]debug=1/.test(window.location.search));
  }, []);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    const out: string[] = [];
    const flush = () => { if (alive) setLines([...out]); };
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        out.push(`session: ${data.session ? "yes" : "NONE"}  uid=${data.session?.user?.id?.slice(0, 8) ?? "-"}`);
      } catch (e) {
        out.push(`session THREW: ${e instanceof Error ? e.message : String(e)}`);
      }
      flush();
      const uid = user?.id;
      const probe = async (
        label: string,
        run: () => Promise<{ data: unknown; error: { message: string } | null; status?: number }>
      ) => {
        const t = Date.now();
        try {
          const { data, error, status } = await run();
          const n = Array.isArray(data) ? data.length : data ? 1 : 0;
          out.push(`${label}: ${Date.now() - t}ms status=${status ?? "?"} ${error ? "ERR " + error.message : "rows=" + n}`);
        } catch (e) {
          out.push(`${label}: ${Date.now() - t}ms THREW ${e instanceof Error ? e.message : String(e)}`);
        }
        flush();
      };
      if (!uid) {
        out.push("no user id (not logged in to the client)");
        flush();
      } else {
        await probe("profiles", () => supabase.from("profiles").select("user_id").eq("user_id", uid).limit(1) as never);
        await probe("meals", () => supabase.from("meals").select("id").eq("user_id", uid).limit(1) as never);
      }
      out.push("done");
      flush();
    })();
    return () => { alive = false; };
  }, [on, user?.id]);

  if (!on) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 99999,
        background: "rgba(0,0,0,0.88)",
        color: "#4ade80",
        font: "11px/1.5 ui-monospace, Menlo, monospace",
        padding: 10,
        borderRadius: 8,
        whiteSpace: "pre-wrap",
        maxHeight: "55vh",
        overflow: "auto",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
