"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { resetPurchases } from "../lib/purchases";

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
  ) => Promise<{ error?: string; needsConfirmation?: boolean }>;
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
      } catch (err) {
        if (!mounted) return;

        setSession(null);
        setUser(null);
      } finally {
        if (!mounted) return;

        setLoading(false);
      }
    };

    init();

    // Watchdog: getSession() normally resolves instantly from local storage, but a stalled
    // token refresh could hang it and pin the splash forever. Fail open after 10s — if a
    // session does resolve later, onAuthStateChange still updates the user.
    const watchdog = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 10000);

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      clearTimeout(watchdog);
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    loading,
    signOut: async () => {
      const pushToken = localStorage.getItem("wya_push_token");
      if (pushToken && user) {
        fetch("/api/push/register", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, token: pushToken }),
        }).catch(() => {});
        localStorage.removeItem("wya_push_token");
      }
      resetPurchases();
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
      if (data.session) {
        setSession(data.session);
        setUser(data.user);
      } else if (data.user) {
        return { needsConfirmation: true };
      }
      return {};
    },
    sendPasswordReset: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) return { error: error.message };
      return {};
    },
    sendPasswordOtp: async (email) => {
      // shouldCreateUser:false — a password reset must never mint a new (passwordless) account for
      // a typo'd or probed address. Only an existing account receives a code.
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
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
