"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      if (!supabaseReady || !supabase) {
        setErrorMsg(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      // Admin area will be protected in a later task.
      router.push("/admin/students");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Login failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm p-3 pb-8">
      <header>
        <h1 className="text-xl font-semibold">Admin login</h1>
        <p className="mt-1 text-sm text-slate-600">
          Sign in to access the admin area.
        </p>
      </header>

      <form className="mt-5 space-y-3" onSubmit={onSubmit}>
        <label className="block">
          <span className="text-sm text-slate-700">Email</span>
          <input
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-700">Password</span>
          <input
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {errorMsg ? (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

