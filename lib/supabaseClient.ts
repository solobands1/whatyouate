import { createClient } from "@supabase/supabase-js";

let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseUrl.startsWith("http")) {
  console.warn("Supabase URL is missing or invalid. Check NEXT_PUBLIC_SUPABASE_URL.");
  supabaseUrl = "https://invalid.supabase.co";
}
if (!supabaseAnonKey) {
  console.warn("Supabase anon key is missing. Check NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  supabaseAnonKey = "invalid-anon-key";
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
