"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { LOCAL_MODE } from "../lib/config";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  signInWithEmailPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmailPassword: (
    email: string,
    password: string,
    profile?: { firstName?: string; lastName?: string }
  ) => Promise<{ error?: string }>;
  sendPasswordReset: (email: string) => Promise<{ error?: string }>;
  sendPasswordOtp: (email: string) => Promise<{ error?: string }>;
  verifyPasswordOtp: (email: string, token: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const DEV_USER = { id: "dev-user", email: "dev@local" } as User;
const LOCAL_SESSION_KEY = "wya_local_session";

function readLocalSession() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(LOCAL_SESSION_KEY) === "true";
}

function writeLocalSession(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) {
    localStorage.setItem(LOCAL_SESSION_KEY, "true");
  } else {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isSupabaseConfigured = !LOCAL_MODE && supabaseUrl.trim().length > 0;

  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (LOCAL_MODE) {
      const hasSession = readLocalSession();
      setUser(hasSession ? DEV_USER : null);
      setSession(null);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setUser(null);
      setSession(null);
      setLoading(false);
      return;
    }
  }, [isSupabaseConfigured]);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    signOut: async () => {
      if (LOCAL_MODE) {
        writeLocalSession(false);
        setUser(null);
        setSession(null);
        return;
      }
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
    },
    signInWithEmailPassword: async (email, password) => {
      if (LOCAL_MODE) {
        writeLocalSession(true);
        setUser(DEV_USER);
        setSession(null);
        return {};
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      setUser(data.user);
      setSession(data.session);
      return {};
    },
    signUpWithEmailPassword: async (email, password, profile) => {
      if (LOCAL_MODE) {
        writeLocalSession(true);
        setUser(DEV_USER);
        setSession(null);
        return {};
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: profile?.firstName ?? "",
            last_name: profile?.lastName ?? ""
          }
        }
      });
      if (error) return { error: error.message };
      if (data.user) {
        setUser(data.user);
      }
      if (data.session) {
        setSession(data.session);
      }
      return {};
    },
    sendPasswordReset: async (email) => {
      if (LOCAL_MODE) {
        return {};
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) return { error: error.message };
      return {};
    },
    sendPasswordOtp: async (email) => {
      if (LOCAL_MODE) {
        return {};
      }
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) return { error: error.message };
      return {};
    },
    verifyPasswordOtp: async (email, token) => {
      if (LOCAL_MODE) {
        return {};
      }
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email"
      });
      if (error) return { error: error.message };
      return {};
    },
    updatePassword: async (password) => {
      if (LOCAL_MODE) {
        return {};
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return { error: error.message };
      return {};
    }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
