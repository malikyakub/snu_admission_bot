"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import {
  ADMIN_HOME,
  readAdminCache,
  verifyAdminAccess,
  writeAdminCache,
} from "@/lib/admin-auth";

/**
 * Layout-level: if a Supabase session exists and the user is an admin,
 * send them to /admin/dashboard (not the student UI or /admin/students).
 */
export function AdminSessionRedirect() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Already in admin area — AdminShell handles that
    if (pathname?.startsWith("/admin")) return;

    let cancelled = false;

    async function run() {
      if (!supabaseReady || !supabase) return;

      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.access_token) return;

      // Fast path: recent successful admin gate (still requires live session)
      if (readAdminCache()) {
        router.replace(ADMIN_HOME);
        return;
      }

      const result = await verifyAdminAccess(session.access_token);
      if (cancelled) return;
      if (!result.ok) return;

      writeAdminCache(result.email ?? session.user.email ?? null);
      router.replace(ADMIN_HOME);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
