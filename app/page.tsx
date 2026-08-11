"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Send,
  Settings,
  Menu,
  ArrowRight,
  User,
  X,
  MessageSquare,
} from "lucide-react";
import { EnrollmentPanel } from "@/components/EnrollmentPanel";
import {
  enrollmentCtaMessage,
  enrollmentWelcomeMessage,
  isEnrollAffirmative,
  isEnrollIntent,
  lastAssistantOfferedEnrollment,
  shouldOfferEnrollmentCta,
} from "@/lib/enrollment-intent";

/* ------------------------------------------------------------------ */
/* Types & localStorage helpers                                         */
/* ------------------------------------------------------------------ */

type ChatMessage = { role: "user" | "assistant"; content: string };

type ConversationIndexEntry = {
  conversation_id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  messageCount: number;
  adminHandoff: boolean;
};

const LS_ACTIVE = "snubot:active_conversation_id";
const LS_INDEX  = "snubot:conversation_index_v1";
const LS_MSG    = (id: string) => `snubot:conversation_messages:${id}`;
const LS_META   = (id: string) => `snubot:conversation_meta:${id}`;

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
function loadMessages(id: string): ChatMessage[] {
  const p = safeJson<ChatMessage[]>(localStorage.getItem(LS_MSG(id)));
  return Array.isArray(p) ? p : [];
}
function loadMeta(id: string) {
  const p = safeJson<{ adminHandoff: boolean }>(localStorage.getItem(LS_META(id)));
  return { adminHandoff: Boolean(p?.adminHandoff) };
}
function upsertIndex(entry: ConversationIndexEntry) {
  const idx = safeJson<Record<string, ConversationIndexEntry>>(localStorage.getItem(LS_INDEX)) ?? {};
  idx[entry.conversation_id] = entry;
  localStorage.setItem(LS_INDEX, JSON.stringify(idx));
}

/* ------------------------------------------------------------------ */
/* 6 suggestion cards                                                   */
/* ------------------------------------------------------------------ */

const SUGGESTION_CARDS = [
  "What faculties are available at SNU?",
  "How do I apply for admission?",
  "What subjects are on the entrance exam?",
  "How much are the tuition fees?",
  "What happens after I pass the exam?",
  "Check my enrollment status",
];

/* ------------------------------------------------------------------ */
/* Avatar components                                                    */
/* ------------------------------------------------------------------ */

function BotAvatar() {
  return (
    <div className="shrink-0 w-8 h-8 rounded-full overflow-hidden border-2 border-sky-200 shadow-sm bg-white flex items-center justify-center">
      <Image
        src="/snu-logo.png"
        alt="SNUBot"
        width={20}
        height={20}
        className="object-contain w-[62%] h-[62%]"
      />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="shrink-0 w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shadow-sm">
      <User className="w-4 h-4 text-white" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar item                                                         */
/* ------------------------------------------------------------------ */

function SidebarItem({
  title,
  active,
  onClick,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-playfair flex items-center gap-2 min-w-0 ${
        active
          ? "bg-sky-50 text-sky-700 font-semibold"
          : "text-slate-600 hover:bg-gray-50"
      }`}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
      <span className="truncate">{title}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function HomePage() {
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [adminHandoff, setAdminHandoff] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [pending, setPending]     = useState(false);
  const [queryConvId, setQueryConvId] = useState<string | null>(null);
  const [convList, setConvList]   = useState<ConversationIndexEntry[]>([]);

  const [enrollOpen, setEnrollOpen] = useState(false);

  const scrollRef         = useRef<HTMLDivElement | null>(null);
  const persistTimer      = useRef<number | null>(null);
  const inputRef          = useRef<HTMLInputElement | null>(null);
  const enrollCtaOffered  = useRef(false);
  const enrollOpenTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (enrollOpenTimer.current) clearTimeout(enrollOpenTimer.current);
    };
  }, []);

  /* read ?conversation= from URL on mount */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("conversation");
    setQueryConvId(q?.trim() || null);
  }, []);

  /* bootstrap / load conversation */
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const reuseId =
        (queryConvId?.trim() || null) ??
        (safeJson<string>(localStorage.getItem(LS_ACTIVE)) ?? null);

      if (reuseId) {
        if (!cancelled) {
          setConversationId(reuseId);
          setMessages(loadMessages(reuseId));
          setAdminHandoff(loadMeta(reuseId).adminHandoff);
        }
        return;
      }

      const newId = crypto.randomUUID();
      if (!cancelled) {
        localStorage.setItem(LS_ACTIVE, JSON.stringify(newId));
        localStorage.setItem(LS_MSG(newId),  JSON.stringify([]));
        localStorage.setItem(LS_META(newId), JSON.stringify({ adminHandoff: false }));
        upsertIndex({ conversation_id: newId, createdAt: Date.now(), updatedAt: Date.now(), title: "New conversation", messageCount: 0, adminHandoff: false });
        setConversationId(newId);
        setMessages([]);
        setAdminHandoff(false);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, [queryConvId]);

  /* reload sidebar list */
  useEffect(() => {
    const idx = safeJson<Record<string, ConversationIndexEntry>>(localStorage.getItem(LS_INDEX)) ?? {};
    setConvList(Object.values(idx).sort((a, b) => b.updatedAt - a.updatedAt));
  }, [messages, conversationId]);

  /* persist messages debounced */
  useEffect(() => {
    if (!conversationId) return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_MSG(conversationId), JSON.stringify(messages));
        const title = messages.find((m) => m.role === "user")?.content?.trim()?.slice(0, 60) ?? "New conversation";
        const idx = safeJson<Record<string, ConversationIndexEntry>>(localStorage.getItem(LS_INDEX)) ?? {};
        upsertIndex({ conversation_id: conversationId, createdAt: idx[conversationId]?.createdAt ?? Date.now(), updatedAt: Date.now(), title, messageCount: messages.length, adminHandoff });
        localStorage.setItem(LS_META(conversationId), JSON.stringify({ adminHandoff }));
      } catch { /* quota */ }
    }, 150);
    return () => { if (persistTimer.current) window.clearTimeout(persistTimer.current); };
  }, [messages, adminHandoff, conversationId]);

  /* auto-scroll */
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  /* ---------------------------------------------------------------- */
  /* Stream                                                             */
  /* ---------------------------------------------------------------- */

  async function streamResponse(
    res: Response
  ): Promise<{ answer: string; openEnrollment?: boolean }> {
    const ct = res.headers.get("content-type") || "";
    const hdr = res.headers.get("x-snubot-handoff-offered") ?? res.headers.get("X-SNUBot-Handoff-Offered");
    if (hdr === "1") setAdminHandoff(true);

    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`Server error (${res.status}): ${detail}`);
    }

    if (!res.body) throw new Error("Empty response body");

    if (!ct.includes("text/event-stream")) {
      const json = await res.json();
      if (json?.needs_human || json?.handoff_offered) setAdminHandoff(true);
      return {
        answer: (json?.answer as string | undefined) ?? "",
        openEnrollment: json?.open_enrollment === true,
      };
    }

    // SSE streaming path
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", assistantText = "";

    setMessages((prev) =>
      prev[prev.length - 1]?.role === "assistant" ? prev : [...prev, { role: "assistant", content: "" }]
    );

    const push = (delta: string) => {
      assistantText += delta;
      setMessages((prev) => {
        const next = [...prev];
        const last = next.length - 1;
        if (next[last]?.role === "assistant") next[last] = { role: "assistant", content: assistantText };
        return next;
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const line of parts) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const d = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (typeof d === "string" && d) push(d);
          } catch { /* malformed SSE chunk — skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { answer: assistantText };
  }

  /* ---------------------------------------------------------------- */
  /* Send                                                               */
  /* ---------------------------------------------------------------- */

  /** Called by EnrollmentPanel when a step is completed — post as user message */
  const handleEnrollStepMessage = useCallback((msg: string) => {
    setMessages(prev => [...prev, { role: "user", content: msg }]);
  }, []);

  function scheduleEnrollmentOpen() {
    if (enrollOpenTimer.current) clearTimeout(enrollOpenTimer.current);
    enrollOpenTimer.current = setTimeout(() => setEnrollOpen(true), 5000);
  }

  function openEnrollmentPanel(userMsg: string, assistantReply?: string) {
    setMessages(prev => [
      ...prev,
      { role: "user", content: userMsg },
      {
        role: "assistant",
        content: assistantReply ?? enrollmentWelcomeMessage(),
      },
    ]);
    setInputValue("");
    // Let the student read the instructions before the form appears
    scheduleEnrollmentOpen();
  }

  async function handleSend(text?: string) {
    if (!conversationId) return;
    const msg = (text ?? inputValue).trim();
    if (!msg || pending) return;

    // Direct enrollment intent OR affirmative after "Ready to enroll?" CTA
    if (
      isEnrollIntent(msg) ||
      (lastAssistantOfferedEnrollment(messages) && isEnrollAffirmative(msg))
    ) {
      openEnrollmentPanel(msg);
      return;
    }

    setPending(true);
    setInputValue("");
    const history: ChatMessage[] = [...messages, { role: "user", content: msg }];
    // Empty assistant bubble shows typing dots while waiting for the response
    setMessages([...history, { role: "assistant", content: "" }]);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 20_000);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversation_id: conversationId, history, stream: true }),
        signal: controller.signal,
      });

      let { answer, openEnrollment } = await streamResponse(res);

      if (openEnrollment) {
        scheduleEnrollmentOpen();
      }

      // After 3 consecutive faculty questions, offer enrollment CTA
      const userMsgs = history.filter((m) => m.role === "user").map((m) => m.content);
      const cta = shouldOfferEnrollmentCta(userMsgs, enrollCtaOffered.current);
      if (cta && answer && !openEnrollment) {
        answer += enrollmentCtaMessage(cta.faculty);
        enrollCtaOffered.current = true;
      }

      if (answer) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: answer };
            return next;
          }
          return [...prev, { role: "assistant", content: answer }];
        });
      }
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"));
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        const placeholder = last?.role === "assistant" && !last.content.trim();
        const errorMsg = isTimeout
          ? "Request timed out — please try again."
          : "Sorry — something went wrong, please try again.";
        if (placeholder) {
          next[next.length - 1] = { role: "assistant", content: errorMsg };
        } else {
          next.push({ role: "assistant", content: errorMsg });
        }
        return next;
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setPending(false);
      inputRef.current?.focus();
    }
  }

  /* ---------------------------------------------------------------- */
  /* New chat / switch                                                  */
  /* ---------------------------------------------------------------- */

  function startNewChat() {
    const newId = crypto.randomUUID();
    localStorage.setItem(LS_ACTIVE, JSON.stringify(newId));
    localStorage.setItem(LS_MSG(newId),  JSON.stringify([]));
    localStorage.setItem(LS_META(newId), JSON.stringify({ adminHandoff: false }));
    upsertIndex({ conversation_id: newId, createdAt: Date.now(), updatedAt: Date.now(), title: "New conversation", messageCount: 0, adminHandoff: false });
    setConversationId(newId); setMessages([]); setAdminHandoff(false);
    setInputValue(""); setSidebarOpen(false);
    enrollCtaOffered.current = false;
    router.push("/");
  }

  function switchConversation(id: string) {
    localStorage.setItem(LS_ACTIVE, JSON.stringify(id));
    setConversationId(id);
    setMessages(loadMessages(id));
    setAdminHandoff(loadMeta(id).adminHandoff);
    setSidebarOpen(false);
    router.push(`/?conversation=${encodeURIComponent(id)}`);
  }

  const isEmpty = messages.length === 0;

  /* ---------------------------------------------------------------- */
  /* Render                                                             */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-full bg-gray-100">

      {/* ── Overlay (mobile) ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Floating sidebar ── */}
      <aside
        className={`
          fixed z-30 top-3 bottom-3 left-3 w-64
          bg-white rounded-2xl shadow-2xl
          flex flex-col overflow-hidden
          transition-transform duration-200
          ${sidebarOpen ? "translate-x-0" : "-translate-x-[calc(100%+12px)]"}
          lg:translate-x-0 lg:static lg:top-auto lg:bottom-auto lg:left-auto
          lg:my-3 lg:ml-3 lg:rounded-2xl lg:shadow-xl
        `}
      >
        {/* ── Sidebar header: logo + name ── */}
        <div className="px-5 pt-5 pb-4 flex items-center gap-3 shrink-0 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-sky-200 shadow shrink-0 bg-white flex items-center justify-center">
            <Image src="/snu-logo.png" alt="SNU" width={24} height={24} className="object-contain w-[62%] h-[62%]" />
          </div>
          <div className="min-w-0">
            <p className="font-bebas text-2xl leading-none text-slate-900 tracking-wide">SNUBOT</p>
            <p className="text-[10px] text-slate-400 font-playfair leading-tight truncate">
              Somali National University
            </p>
          </div>
          {/* close button mobile */}
          <button type="button" onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── New chat ── */}
        <div className="px-4 pt-3 pb-2 shrink-0">
          <button
            type="button"
            onClick={startNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-600 transition-colors font-playfair"
          >
            <Plus className="w-4 h-4" />
            New chat
          </button>
        </div>

        {/* ── Conversation list ── */}
        <div className="flex-1 overflow-y-auto px-3 py-1">
          <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest font-playfair">
            Your conversations
          </p>
          {convList.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-400 font-playfair">No conversations yet.</p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {convList.map((c) => (
                <SidebarItem
                  key={c.conversation_id}
                  title={c.title}
                  active={c.conversation_id === conversationId}
                  onClick={() => switchConversation(c.conversation_id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-4 pb-4 pt-3 border-t border-gray-100 shrink-0">
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 font-playfair"
          >
            <Settings className="w-4 h-4" />
            Admin login
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col min-w-0">

        {/* top bar – mobile only */}
        <div className="flex items-center gap-3 px-4 py-3 lg:hidden shrink-0">
          <button type="button" onClick={() => setSidebarOpen(true)} className="p-1 rounded text-slate-600" aria-label="Open sidebar">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-bebas text-2xl text-slate-900 tracking-wide">SNUBOT</span>
        </div>

        {/* messages / welcome */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {isEmpty ? (
            /* ── Welcome screen ── */
            <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
              {/* logo pill */}
              <div className="mb-4 flex items-center gap-3 px-5 py-2 rounded-full bg-white border border-gray-200 shadow-sm">
                <div className="w-8 h-8 rounded-full overflow-hidden border border-sky-200 bg-white flex items-center justify-center">
                  <Image src="/snu-logo.png" alt="SNU" width={20} height={20} className="object-contain w-[62%] h-[62%]" />
                </div>
                <span className="font-bebas text-xl tracking-wide text-slate-800">SNUBOT</span>
              </div>

              <h1 className="font-playfair text-3xl font-bold text-slate-900 mb-2">
                How can I help you today?
              </h1>
              <p className="font-playfair text-sm text-slate-500 mb-8">
                Ask about programs, admissions, fees, or enrollment at SNU.
              </p>

              {/* 6 cards — 2 per row */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUGGESTION_CARDS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setInputValue(label); inputRef.current?.focus(); }}
                    className="group flex items-center justify-between gap-3 rounded-xl bg-white border border-gray-200 px-4 py-4 text-left hover:border-sky-300 hover:shadow-sm transition-all"
                  >
                    <span className="font-playfair text-sm text-slate-700">{label}</span>
                    <ArrowRight className="shrink-0 w-4 h-4 text-slate-400 group-hover:text-sky-500 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Chat messages ── */
            <div className="max-w-2xl mx-auto flex flex-col gap-5">
              {adminHandoff && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-playfair">
                  This conversation has been passed to an admin.
                </div>
              )}

              {messages.map((m, idx) => {
                const isLastAssistant =
                  m.role === "assistant" && idx === messages.length - 1;
                const isTyping = isLastAssistant && pending && !m.content.trim();

                return (
                  <div
                    key={`${idx}-${m.role}`}
                    className={`flex items-start gap-3 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {/* avatar */}
                    {m.role === "assistant" ? <BotAvatar /> : <UserAvatar />}

                    <div className={`max-w-[78%] flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                      {/* name label */}
                      <span className="text-[11px] font-semibold text-slate-400 font-playfair px-1">
                        {m.role === "assistant" ? "SNUBot" : "You"}
                      </span>

                      {/* bubble */}
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm ${
                          m.role === "user"
                            ? "bg-sky-500 text-white rounded-tr-sm"
                            : "bg-white text-slate-900 shadow-sm border border-gray-100 rounded-tl-sm"
                        }`}
                      >
                        {isTyping ? (
                          <span className="text-xs text-slate-400 font-playfair italic">
                            typing...
                          </span>
                        ) : m.role === "assistant" ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p:      ({ node, ...p }) => <p      className="mb-2 last:mb-0 leading-relaxed font-playfair" {...p} />,
                              ul:     ({ node, ...p }) => <ul     className="list-disc pl-5 space-y-1 mb-2 last:mb-0" {...p} />,
                              ol:     ({ node, ...p }) => <ol     className="list-decimal pl-5 space-y-1 mb-2 last:mb-0" {...p} />,
                              li:     ({ node, ...p }) => <li     className="leading-relaxed font-playfair" {...p} />,
                              strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
                            }}
                          >
                            {m.content}
                          </ReactMarkdown>
                        ) : (
                          <span className="font-playfair">{m.content}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={scrollRef} />
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        <div className="shrink-0 px-4 pb-5 pt-2 relative">
          <div className="max-w-2xl mx-auto relative">
            {/* Enrollment panel drop-up */}
            <EnrollmentPanel
              open={enrollOpen}
              onClose={() => setEnrollOpen(false)}
              conversationId={conversationId}
              onStepMessage={handleEnrollStepMessage}
            />

            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex items-center gap-2 bg-white rounded-full border border-gray-200 shadow-sm px-4 py-2.5"
            >
              {/* Enrollment trigger button */}
              <button
                type="button"
                title="Start application"
                onClick={() => setEnrollOpen(o => !o)}
                className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  enrollOpen
                    ? "bg-sky-100 text-sky-600"
                    : "text-slate-400 hover:text-sky-500 hover:bg-sky-50"
                }`}
                aria-label="Open enrollment form"
              >
                <Plus className="w-4 h-4" />
              </button>

              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none font-playfair"
                placeholder="What's in your mind..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={pending || !conversationId}
              />
              <button
                type="submit"
                disabled={pending || !conversationId || !inputValue.trim()}
                className="shrink-0 w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-white disabled:opacity-50 hover:bg-sky-600 transition-colors"
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
