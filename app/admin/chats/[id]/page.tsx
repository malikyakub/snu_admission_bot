"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Send, User, UserStar, Bot, ClipboardList } from "lucide-react";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant" | "system" | "admin";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
};

function stripCtas(text: string): string {
  return text.replace(/\[\[cta:[^\]]+\]\]/gi, "").trim();
}

/** Ctrl/Cmd+B: wrap selection in **…** (markdown bold), or open markers with cursor inside. */
function applyBoldShortcut(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { next: string; start: number; end: number } {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const selected = value.slice(start, end);

  // Unwrap if selection is already **…**
  if (
    selected.length >= 4 &&
    selected.startsWith("**") &&
    selected.endsWith("**")
  ) {
    const inner = selected.slice(2, -2);
    return {
      next: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    };
  }

  // Unwrap if markers sit immediately outside the selection
  if (
    start >= 2 &&
    end + 2 <= value.length &&
    value.slice(start - 2, start) === "**" &&
    value.slice(end, end + 2) === "**"
  ) {
    return {
      next: value.slice(0, start - 2) + selected + value.slice(end + 2),
      start: start - 2,
      end: start - 2 + selected.length,
    };
  }

  if (start === end) {
    const next = `${value.slice(0, start)}****${value.slice(end)}`;
    return { next, start: start + 2, end: start + 2 };
  }

  const next = `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
  return { next, start: start + 2, end: start + 2 + selected.length };
}

async function authHeaders(): Promise<HeadersInit | null> {
  if (!supabaseReady || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

function BotAvatar() {
  return (
    <div className="w-8 h-8 rounded-full overflow-hidden border border-sky-200 bg-white flex items-center justify-center shrink-0 shadow-sm">
      <Image
        src="/snu-logo.png"
        alt="SNUBot"
        width={20}
        height={20}
        className="object-contain w-[70%] h-[70%]"
      />
    </div>
  );
}

function StudentAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-slate-500 flex items-center justify-center shrink-0">
      <User className="w-4 h-4 text-white" />
    </div>
  );
}

function AdminAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center shrink-0">
      <UserStar className="w-4 h-4 text-white" />
    </div>
  );
}

function BubbleMarkdown({
  content,
  tone,
}: {
  content: string;
  tone: "student" | "admin";
}) {
  const text = stripCtas(content);
  if (!text) return null;

  const isAdmin = tone === "admin";

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ node, ...p }) => (
          <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap" {...p} />
        ),
        ul: ({ node, ...p }) => (
          <ul className="list-disc pl-4 space-y-1 mb-2 last:mb-0" {...p} />
        ),
        ol: ({ node, ...p }) => (
          <ol className="list-decimal pl-4 space-y-1 mb-2 last:mb-0" {...p} />
        ),
        li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
        strong: ({ node, ...p }) => (
          <strong className="font-semibold" {...p} />
        ),
        em: ({ node, ...p }) => <em className="italic" {...p} />,
        a: ({ node, href, children, ...p }) => (
          <a
            className={cn(
              "underline underline-offset-2",
              isAdmin ? "text-sky-100" : "text-sky-700"
            )}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            {...p}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function BotBody({ content }: { content: string }) {
  const text = stripCtas(content);
  if (!text) return null;
  return (
    <div className="font-roboto text-sm text-slate-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, ...p }) => (
            <p className="mb-3 last:mb-0 leading-relaxed whitespace-pre-wrap" {...p} />
          ),
          ul: ({ node, ...p }) => (
            <ul className="list-disc pl-5 space-y-1 mb-3 last:mb-0" {...p} />
          ),
          ol: ({ node, ...p }) => (
            <ol className="list-decimal pl-5 space-y-1 mb-3 last:mb-0" {...p} />
          ),
          li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
          strong: ({ node, ...p }) => (
            <strong className="font-semibold" {...p} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default function AdminChatPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState("Requested chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [needsHuman, setNeedsHuman] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<"release" | "enroll" | null>(
    null
  );
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const headers = await authHeaders();
    if (!headers) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/admin/chats/${id}`, { headers });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        conversation?: { title?: string | null; needs_human?: boolean };
        messages?: ChatMessage[];
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Failed to load chat.");
        return;
      }
      setTitle(json.conversation?.title?.trim() || "Requested chat");
      setNeedsHuman(json.conversation?.needs_human !== false);
      setMessages(json.messages ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!id || !supabaseReady || !supabase) return;
    const channel = supabase
      .channel(`admin-chat-${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${id}`,
        },
        () => {
          void reload();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, reload]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function resizeInput() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function handleBoldShortcut() {
    const el = inputRef.current;
    if (!el) return;
    const { next, start, end } = applyBoldShortcut(
      el.value,
      el.selectionStart,
      el.selectionEnd
    );
    setInputValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, end);
      resizeInput();
    });
  }

  async function handleSend() {
    const msg = inputValue.trim();
    if (!msg || !id || sending) return;

    setSending(true);
    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "admin",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Not signed in.");

      const res = await fetch(`/api/admin/chats/${id}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ content: msg }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: ChatMessage;
      };
      if (!res.ok || !json.ok || !json.message) {
        throw new Error(json.error || "Failed to send message.");
      }
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimistic.id);
        if (withoutOptimistic.some((m) => m.id === json.message!.id)) {
          return withoutOptimistic;
        }
        return [...withoutOptimistic, json.message!];
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInputValue(msg);
      toast({
        title: err instanceof Error ? err.message : "Failed to send message.",
        variant: "error",
      });
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  async function runAction(action: "release" | "start_enrollment") {
    if (!id || actionBusy) return;
    setActionBusy(action === "release" ? "release" : "enroll");
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Not signed in.");
      const res = await fetch(`/api/admin/chats/${id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: ChatMessage;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Action failed.");
      }
      setNeedsHuman(false);
      if (json.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === json.message!.id)) return prev;
          return [...prev, json.message!];
        });
      }
      toast({
        title:
          action === "release"
            ? json.message
              ? "Handed back — bot replied"
              : "Handed back to bot"
            : "Enrollment started for student",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Action failed.",
        variant: "error",
      });
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80 overflow-hidden">
      <div className="shrink-0 border-b border-slate-100 px-5 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-slate-900 font-roboto">
              {title}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 font-roboto">
              {needsHuman
                ? "Admin handoff active — bot is silent"
                : "Bot is active on this chat"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!needsHuman || actionBusy !== null || loading}
            onClick={() => void runAction("release")}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 font-roboto"
          >
            {actionBusy === "release" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="h-3.5 w-3.5" />
            )}
            Hand back to bot
          </button>
          <button
            type="button"
            disabled={actionBusy !== null || loading}
            onClick={() => void runAction("start_enrollment")}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50 font-roboto"
          >
            {actionBusy === "enroll" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClipboardList className="h-3.5 w-3.5" />
            )}
            Start enrollment
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading conversation…
          </p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-red-600">{error}</p>
        ) : messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            No messages yet.
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-5">
            {messages.map((m) => {
              const role = m.role;
              const isStudent = role === "user";
              const isAdmin = role === "admin";
              const isBot = role === "assistant" || role === "system";

              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-start gap-3",
                    isAdmin ? "flex-row-reverse" : "flex-row"
                  )}
                >
                  {isAdmin ? (
                    <AdminAvatar />
                  ) : isStudent ? (
                    <StudentAvatar />
                  ) : (
                    <BotAvatar />
                  )}

                  <div
                    className={cn(
                      "max-w-[85%] flex flex-col gap-1",
                      isAdmin ? "items-end" : "items-start"
                    )}
                  >
                    <span className="px-0.5 text-[11px] font-semibold text-slate-400 font-roboto">
                      {isAdmin ? "Admin" : isStudent ? "Student" : "SNUBot"}
                    </span>

                    {isBot ? (
                      <BotBody content={m.content} />
                    ) : (
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-3 text-sm font-roboto",
                          isAdmin
                            ? "rounded-tr-sm bg-sky-600 text-white"
                            : "rounded-tl-sm bg-slate-100 text-slate-800"
                        )}
                      >
                        <BubbleMarkdown
                          content={m.content}
                          tone={isAdmin ? "admin" : "student"}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={scrollRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="mx-auto flex max-w-2xl items-end gap-2 rounded-[1.75rem] border border-gray-200 bg-white px-3 py-2 shadow-sm"
        >
          <textarea
            ref={inputRef}
            rows={1}
            className="max-h-40 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1.5 text-sm leading-5 text-slate-800 outline-none placeholder-slate-400 font-roboto"
            placeholder="Reply to the student…"
            value={inputValue}
            disabled={sending || !id || loading || Boolean(error)}
            onChange={(e) => {
              setInputValue(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                e.preventDefault();
                handleBoldShortcut();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="submit"
            disabled={
              sending || !id || loading || Boolean(error) || !inputValue.trim()
            }
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
            aria-label="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
