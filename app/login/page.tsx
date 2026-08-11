"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import {
  ADMIN_HOME,
  ADMIN_UNAUTHORIZED_MESSAGE,
  mapAuthLoginError,
  writeAdminCache,
} from "@/lib/admin-auth";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

      // 1) Authenticate first — fail before any admins-table check
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (authError) {
        setErrorMsg(mapAuthLoginError(authError));
        return;
      }

      const session = authData.session;
      const user = authData.user;
      if (!session?.access_token || !user) {
        setErrorMsg(mapAuthLoginError({ message: "Invalid login credentials" }));
        return;
      }

      // 2) Require a matching public.admins row (server-side, service role)
      const verifyRes = await fetch("/api/admin/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const verifyJson = (await verifyRes.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!verifyRes.ok || !verifyJson?.ok) {
        await supabase.auth.signOut();
        setErrorMsg(
          verifyJson?.error ||
            ADMIN_UNAUTHORIZED_MESSAGE
        );
        return;
      }

      writeAdminCache(user.email ?? email.trim());
      router.replace(ADMIN_HOME);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Login failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page min-h-full grid lg:grid-cols-2 bg-white">
      {/* Brand panel — large SNU emblem */}
      <section
        aria-label="Somali National University"
        className="relative hidden lg:flex flex-col overflow-hidden login-brand-panel"
      >
        <div className="absolute inset-0 login-brand-glow" aria-hidden />
        <div className="relative z-10 flex flex-1 flex-col px-10 py-10 xl:px-14">
          <p className="font-bebas text-2xl tracking-[0.12em] text-white/95">
            SNUBOT
          </p>
          <div className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
            <div className="login-emblem-wrap relative w-[min(72%,420px)] aspect-square">
              <Image
                src="/snu-emblem.png"
                alt="Somali National University emblem"
                fill
                priority
                className="object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.45)]"
                sizes="(min-width: 1024px) 420px, 0px"
              />
            </div>
            <div className="text-center max-w-md login-brand-copy">
              <h1 className="font-playfair text-3xl xl:text-4xl font-semibold text-white leading-tight">
                Somali National University
              </h1>
              <p className="mt-3 text-sm xl:text-base text-sky-100/85 leading-relaxed">
                Admissions administration — review applications, manage
                conversations, and support students.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Login form */}
      <section className="flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-md login-form-panel">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image
              src="/snu-logo.png"
              alt=""
              width={48}
              height={48}
              className="rounded-full bg-black object-contain"
            />
            <div>
              <p className="font-bebas text-lg tracking-wider text-slate-900">
                SNUBOT
              </p>
              <p className="text-xs text-slate-500">Admin access</p>
            </div>
          </div>

          <header>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
              Admin login
            </h2>
            <p className="mt-2 text-sm text-slate-500 leading-relaxed">
              Sign in with your staff account to open the admin area.
            </p>
          </header>

          <form className="mt-8 space-y-5" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-slate-700">
                Email address
              </Label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                placeholder="ex.email@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3.5 text-sm placeholder:text-slate-400 focus-visible:bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-password" className="text-slate-700">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-11 rounded-xl border-slate-200 bg-slate-50 px-3.5 pr-11 text-sm placeholder:text-slate-400 focus-visible:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {errorMsg ? (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
              >
                {errorMsg}
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-sky-600 text-sm font-medium text-white hover:bg-sky-700 focus-visible:ring-sky-200"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            <Link
              href="/"
              className="font-medium text-sky-700 hover:text-sky-800 hover:underline underline-offset-2"
            >
              ← Back to student chat
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
