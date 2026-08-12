"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import type { RecentChat } from "@/lib/admin-recent-chats";
import { cn } from "@/lib/utils";

function speakerLabel(role: RecentChat["last_role"] | "admin"): string {
  if (role === "assistant") return "Bot";
  if (role === "user") return "Student";
  if (role === "admin") return "Admin";
  return "System";
}

async function authHeaders(): Promise<HeadersInit | null> {
  if (!supabaseReady || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export function RecentChatsPanel({ className }: { className?: string }) {
  const [chats, setChats] = useState<RecentChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/recent-chats", { headers });
      const json = (await res.json()) as {
        ok?: boolean;
        chats?: RecentChat[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Failed to load recent chats.");
        return;
      }
      setChats(json.chats ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recent chats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!supabaseReady || !supabase) return;

    const client = supabase;
    const channel = client
      .channel("admin-recent-chats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => {
          void reload();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => {
          void reload();
        }
      )
      .subscribe();

    // Fallback poll in case Realtime publication is not enabled yet
    const poll = window.setInterval(() => {
      void reload();
    }, 12_000);

    return () => {
      window.clearInterval(poll);
      void client.removeChannel(channel);
    };
  }, [reload]);

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-col bg-white shadow-sm ring-slate-200/80",
        className
      )}
    >
      <CardHeader className="shrink-0 pb-3">
        <CardTitle className="text-base text-slate-900">Recent chats</CardTitle>
        <CardDescription>Last 6 conversations with latest message</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-2 pb-3">
        {loading ? (
          <p className="flex items-center gap-2 px-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : error ? (
          <p className="px-2 py-4 text-sm text-red-600">{error}</p>
        ) : chats.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-slate-500">
            No chats yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 overflow-hidden">
            {chats.map((chat) => (
              <li
                key={chat.conversation_id}
                className="rounded-md px-3 py-2 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-slate-900 font-roboto">
                    {chat.title}
                  </p>
                  <time
                    className="shrink-0 text-[10px] text-slate-400 font-roboto"
                    dateTime={chat.last_at}
                    title={new Date(chat.last_at).toLocaleString()}
                  >
                    {formatDistanceToNow(new Date(chat.last_at), {
                      addSuffix: true,
                    })}
                  </time>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500 font-roboto">
                  <span
                    className={cn(
                      "font-semibold",
                      chat.last_role === "assistant"
                        ? "text-sky-700"
                        : "text-slate-700"
                    )}
                  >
                    {speakerLabel(chat.last_role)}:
                  </span>{" "}
                  {chat.last_message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
