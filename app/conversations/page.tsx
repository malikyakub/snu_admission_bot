"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Settings, Menu, MessageSquare } from "lucide-react";

type ConversationIndexEntry = {
  conversation_id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  messageCount: number;
  adminHandoff: boolean;
};

const LS_ACTIVE = "snubot:active_conversation_id";
const LS_INDEX = "snubot:conversation_index_v1";

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

export default function ConversationsPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<ConversationIndexEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const idx = safeJson<Record<string, ConversationIndexEntry>>(
      localStorage.getItem(LS_INDEX)
    );
    const list = idx ? Object.values(idx) : [];
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    setEntries(list);
    setLoaded(true);
  }, []);

  function open(id: string) {
    localStorage.setItem(LS_ACTIVE, JSON.stringify(id));
    router.push(`/?conversation=${encodeURIComponent(id)}`);
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="px-5 pt-6 pb-4 shrink-0">
          <span className="text-lg font-bold tracking-tight text-slate-900">SNUBot</span>
        </div>
        <div className="px-4 pb-3 shrink-0">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <p className="px-2 pb-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
            Your conversations
          </p>
          {entries.map((e) => (
            <button
              key={e.conversation_id}
              type="button"
              onClick={() => open(e.conversation_id)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm truncate text-slate-600 hover:bg-gray-100 transition-colors"
            >
              {e.title}
            </button>
          ))}
        </div>
        <div className="px-4 pb-5 pt-3 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <Settings className="w-4 h-4" /> Admin login
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col bg-gray-100 min-w-0">
        {/* top bar */}
        <div className="flex items-center gap-3 px-5 py-4 bg-white border-b border-gray-200 shrink-0">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="lg:hidden p-1 rounded text-slate-600"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-slate-900">Past conversations</h1>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="max-w-2xl mx-auto">
            {loaded && entries.length === 0 ? (
              <div className="rounded-xl bg-white border border-gray-200 p-6 text-center text-sm text-slate-500 shadow-sm">
                <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <p className="font-medium mb-1">No past conversations yet.</p>
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="mt-2 text-sky-500 hover:underline text-sm"
                >
                  Start your first conversation →
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {entries.map((e) => (
                  <button
                    key={e.conversation_id}
                    type="button"
                    onClick={() => open(e.conversation_id)}
                    className="text-left rounded-xl bg-white border border-gray-200 px-5 py-4 hover:border-sky-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-sm text-slate-800">
                          {e.title || "New conversation"}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-400">
                          {new Date(e.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-slate-400">
                        {e.messageCount} msg
                      </div>
                    </div>
                    {e.adminHandoff && (
                      <span className="mt-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        Sent to admin
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
