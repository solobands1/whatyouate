"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
        setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
      signInWithEmailPassword: async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        return error ? { error: error.message } : {};
      },
      signUpWithEmailPassword: async (
        email: string,
        password: string,
        profile?: { firstName?: string; lastName?: string }
      ) => {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: profile
            ? {
                data: {
                  first_name: profile.firstName ?? "",
                  last_name: profile.lastName ?? ""
                }
              }
            : undefined
        });
        return error ? { error: error.message } : {};
      },
      sendPasswordReset: async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined
        });
        return error ? { error: error.message } : {};
      },
      sendPasswordOtp: async (email: string) => {
        const { error } = await supabase.auth.signInWithOtp({ email });
        return error ? { error: error.message } : {};
      },
      verifyPasswordOtp: async (email: string, token: string) => {
        const { error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: "recovery"
        });
        return error ? { error: error.message } : {};
      },
      updatePassword: async (password: string) => {
        const { error } = await supabase.auth.updateUser({ password });
        return error ? { error: error.message } : {};
      }
    }),
    [user, session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
