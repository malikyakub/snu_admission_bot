"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Loader2,
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import {
  clearAdminCache,
  readAdminCache,
  verifyAdminAccess,
  writeAdminCache,
} from "@/lib/admin-auth";
import type { RequestedChat } from "@/lib/admin-requested-chats";
import { cn } from "@/lib/utils";

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium font-roboto transition-colors",
        active
          ? "bg-sky-50 text-sky-800"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}

async function authHeaders(): Promise<HeadersInit | null> {
  if (!supabaseReady || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"loading" | "ok" | "denied">("loading");
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [requested, setRequested] = useState<RequestedChat[]>([]);
  const [requestedLoading, setRequestedLoading] = useState(true);

  // Restore cached gate before paint so nav within /admin doesn't flash
  useLayoutEffect(() => {
    const cached = readAdminCache();
    if (cached) {
      setAdminEmail(cached.email);
      setStatus("ok");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function gate() {
      if (!supabaseReady || !supabase) {
        clearAdminCache();
        router.replace("/login");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session?.access_token) {
        clearAdminCache();
        router.replace("/login");
        return;
      }

      const result = await verifyAdminAccess(session.access_token);
      if (cancelled) return;

      if (!result.ok) {
        clearAdminCache();
        await supabase.auth.signOut();
        setStatus("denied");
        router.replace("/login");
        return;
      }

      const email = result.email ?? session.user.email ?? null;
      writeAdminCache(email);
      setAdminEmail(email);
      setStatus("ok");
    }

    void gate();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const reloadRequested = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) {
      setRequestedLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/requested-chats", { headers });
      const json = (await res.json()) as {
        ok?: boolean;
        chats?: RequestedChat[];
      };
      if (res.ok && json.ok) {
        setRequested(json.chats ?? []);
      }
    } catch {
      /* keep previous list */
    } finally {
      setRequestedLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ok") return;
    void reloadRequested();
  }, [status, reloadRequested]);

  useEffect(() => {
    if (status !== "ok" || !supabaseReady || !supabase) return;

    const client = supabase;
    const channel = client
      .channel("admin-requested-chats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => {
          void reloadRequested();
        }
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void reloadRequested();
    }, 15_000);

    return () => {
      window.clearInterval(poll);
      void client.removeChannel(channel);
    };
  }, [status, reloadRequested]);

  async function signOut() {
    clearAdminCache();
    if (supabase) await supabase.auth.signOut();
    router.replace("/login");
  }

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100">
        <p className="flex items-center gap-2 text-sm text-slate-600 font-roboto">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking admin access…
        </p>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100 p-6">
        <p className="text-sm text-slate-600 font-roboto">
          Not authorized.{" "}
          <Link href="/login" className="text-sky-700 underline">
            Back to login
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed z-30 top-3 bottom-3 left-3 w-64
          bg-white rounded-lg shadow-2xl
          flex flex-col overflow-hidden
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-[calc(100%+12px)]"}
          lg:translate-x-0 lg:static lg:top-auto lg:bottom-auto lg:left-auto
          lg:my-3 lg:ml-3 lg:rounded-lg lg:shadow-xl
        `}
      >
        <div className="px-5 pt-5 pb-4 flex items-center gap-3 shrink-0 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-sky-200 shadow shrink-0 bg-white flex items-center justify-center">
            <Image
              src="/snu-logo.png"
              alt="SNU"
              width={24}
              height={24}
              className="object-contain w-[62%] h-[62%]"
            />
          </div>
          <div className="min-w-0">
            <p className="font-bebas text-2xl leading-none text-slate-900 tracking-wide">
              SNUBOT
            </p>
            <p className="text-[10px] text-slate-400 font-roboto leading-tight truncate">
              Admin console
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-slate-400 hover:text-slate-600"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest font-roboto">
            Navigation
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            <NavItem
              href="/admin/dashboard"
              label="Dashboard"
              icon={LayoutDashboard}
              active={pathname === "/admin/dashboard"}
              onNavigate={() => setSidebarOpen(false)}
            />
            <NavItem
              href="/admin/students"
              label="Students"
              icon={Users}
              active={pathname === "/admin/students"}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>

          <div className="mx-2 my-3 border-t border-slate-200" />

          <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest font-roboto">
            Requested chats
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            {requestedLoading ? (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400 font-roboto">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </p>
            ) : requested.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400 font-roboto">
                No admin requests yet
              </p>
            ) : (
              (() => {
                const awaiting = requested.filter((c) => c.awaiting_reply);
                const replied = requested.filter((c) => !c.awaiting_reply);

                const renderChat = (chat: RequestedChat) => {
                  const href = `/admin/chats/${chat.conversation_id}`;
                  const active = pathname === href;
                  return (
                    <Link
                      key={chat.conversation_id}
                      href={href}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        "flex items-start gap-2 rounded-md px-3 py-2 text-left font-roboto transition-colors",
                        active
                          ? "bg-sky-50 text-sky-800"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                      title={chat.title}
                    >
                      {chat.awaiting_reply ? (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500"
                          aria-label="Awaiting reply"
                          title="Awaiting reply"
                        />
                      ) : (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0" aria-hidden />
                      )}
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm leading-snug",
                          chat.awaiting_reply
                            ? "font-medium"
                            : "font-normal text-slate-500"
                        )}
                      >
                        {chat.title}
                      </span>
                    </Link>
                  );
                };

                return (
                  <>
                    {awaiting.map(renderChat)}
                    {awaiting.length > 0 && replied.length > 0 ? (
                      <div
                        className="mx-3 my-1.5 border-t border-slate-200"
                        role="separator"
                        aria-label="Replied chats"
                      />
                    ) : null}
                    {replied.map(renderChat)}
                  </>
                );
              })()
            )}
          </div>
        </div>

        <div className="px-4 pb-4 pt-3 border-t border-gray-100 shrink-0 space-y-2">
          {adminEmail ? (
            <p className="px-1 text-xs text-slate-500 font-roboto truncate">
              {adminEmail}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700 font-roboto"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 lg:hidden shrink-0">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded text-slate-600"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bebas text-2xl text-slate-900 tracking-wide">
            SNUBOT
          </span>
        </div>

        <div className="flex flex-1 flex-col min-h-0 overflow-hidden px-3 py-3 lg:pr-3">
          <div className="flex h-full w-full min-h-0 flex-col">{children}</div>
        </div>
      </div>
    </div>
  );
}
