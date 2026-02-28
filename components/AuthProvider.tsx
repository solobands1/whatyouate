"use client";

import { createContext, useContext, useEffect, useState } from "react";
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
    let mounted = true;

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();

        if (!mounted) return;

        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);

        console.log("[auth] session loaded", data.session);
      } catch (err) {
        console.log("[auth] session error", err);

        if (!mounted) return;

        setSession(null);
        setUser(null);
      } finally {
        if (!mounted) return;

        setLoading(false);

        console.log("[auth] loading=false");
      }
    };

    init();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log("[auth] state change", session);

      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
    },
    signInWithEmailPassword: async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      setUser(data.user);
      setSession(data.session);
      return {};
    },
    signUpWithEmailPassword: async (email, password, profile) => {
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
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) return { error: error.message };
      return {};
    },
    sendPasswordOtp: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) return { error: error.message };
      return {};
    },
    verifyPasswordOtp: async (email, token) => {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email"
      });
      if (error) return { error: error.message };
      return {};
    },
    updatePassword: async (password) => {
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
