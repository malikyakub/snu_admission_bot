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
  UserStar,
  X,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { EnrollmentPanel } from "@/components/EnrollmentPanel";
import { useToast } from "@/components/Toast";
import { parseCtaContent, type CtaKind } from "@/lib/cta";
import {
  enrollmentCtaMessage,
  enrollmentWelcomeMessage,
  shouldOfferEnrollmentCta,
} from "@/lib/enrollment-intent";
import {
  decodeSourcesHeader,
  type ChatSource,
} from "@/lib/sources";
import {
  fetchConversationBundle,
  type RemoteChatMessage,
} from "@/lib/student-realtime";

/* ------------------------------------------------------------------ */
/* Types & localStorage helpers                                         */
/* ------------------------------------------------------------------ */

type ChatMessage = {
  id?: string;
  role: "user" | "assistant" | "admin";
  content: string;
  sources?: ChatSource[];
};

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
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readIndex(): Record<string, ConversationIndexEntry> {
  return (
    safeJson<Record<string, ConversationIndexEntry>>(
      localStorage.getItem(LS_INDEX)
    ) ?? {}
  );
}

function upsertIndex(entry: ConversationIndexEntry) {
  const idx = readIndex();
  idx[entry.conversation_id] = entry;
  localStorage.setItem(LS_INDEX, JSON.stringify(idx));
}

function setActiveConversationId(id: string) {
  localStorage.setItem(LS_ACTIVE, JSON.stringify(id));
}

function readActiveConversationId(): string | null {
  return safeJson<string>(localStorage.getItem(LS_ACTIVE));
}

function sortedIndexList(): ConversationIndexEntry[] {
  return Object.values(readIndex()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function titleFromMessages(messages: ChatMessage[]): string {
  return (
    messages.find((m) => m.role === "user")?.content?.trim()?.slice(0, 60) ||
    "New conversation"
  );
}

/** Sidebar metadata only — message bodies live in the DB. */
function syncIndexMeta(
  conversationId: string,
  messages: ChatMessage[],
  adminHandoff: boolean,
  opts?: { bumpUpdatedAt?: boolean; title?: string | null }
) {
  const prev = readIndex()[conversationId];
  const bump = opts?.bumpUpdatedAt !== false;
  const dbTitle = opts?.title?.trim() || null;
  const prevTitle = prev?.title?.trim() || null;
  const title =
    dbTitle ||
    (prevTitle && prevTitle !== "New conversation" ? prevTitle : null) ||
    titleFromMessages(messages) ||
    "New conversation";

  upsertIndex({
    conversation_id: conversationId,
    createdAt: prev?.createdAt ?? Date.now(),
    updatedAt: bump ? Date.now() : (prev?.updatedAt ?? Date.now()),
    title,
    messageCount: messages.length,
    adminHandoff,
  });
}

/* ------------------------------------------------------------------ */
/* Top 6 common admissions questions (from readiness battery) */
const SUGGESTION_CARDS = [
  "What documents do I need to submit for the online application?",
  "What programs does the Faculty of Engineering offer?",
  "What subjects are covered in the SNU admission exam?",
  "Can I choose two Tier 1 faculties as my top choices?",
  "What score do I need to get placed into my first-choice faculty?",
  "How can I check my enrollment status?",
];

/* ------------------------------------------------------------------ */
/* Avatar components                                                    */
/* ------------------------------------------------------------------ */

function BotAvatar() {
  return (
    <div className="w-8 h-8 rounded-full overflow-hidden border border-sky-200 bg-white flex items-center justify-center shrink-0 shadow-sm">
      <Image src="/snu-logo.png" alt="SNUBot" width={20} height={20} className="object-contain w-[70%] h-[70%]" />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center shrink-0">
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

function remoteToChatMessages(rows: RemoteChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const row of rows) {
    if (row.role === "system") continue;
    if (row.role !== "user" && row.role !== "assistant" && row.role !== "admin") {
      continue;
    }
    out.push({
      id: row.id,
      role: row.role,
      content: row.content,
    });
  }
  return out;
}

/** Merge remote DB messages into local UI state without clobbering an in-flight stream. */
function mergeRemoteIntoLocal(
  local: ChatMessage[],
  remote: ChatMessage[],
  isPending: boolean
): ChatMessage[] {
  if (remote.length === 0) return local;

  if (isPending) {
    const ids = new Set(local.map((m) => m.id).filter(Boolean) as string[]);
    const fingerprints = new Set(local.map((m) => `${m.role}\0${m.content}`));
    const next = [...local];
    for (const m of remote) {
      if (m.id && ids.has(m.id)) continue;
      if (fingerprints.has(`${m.role}\0${m.content}`)) continue;
      // During a stream, only pull in admin replies
      if (m.role === "admin") {
        next.push(m);
        if (m.id) ids.add(m.id);
        fingerprints.add(`${m.role}\0${m.content}`);
      }
    }
    return next;
  }

  // Prefer remote order; keep local sources on matching assistant messages
  const sourceByContent = new Map<string, ChatSource[]>();
  for (const m of local) {
    if (m.role === "assistant" && m.sources?.length) {
      sourceByContent.set(m.content, m.sources);
    }
  }

  const merged = remote.map((m) => {
    if (m.role === "assistant") {
      const sources = sourceByContent.get(m.content);
      return sources ? { ...m, sources } : m;
    }
    return m;
  });

  // Keep local-only turns not yet persisted (enrollment welcome, race before insert)
  const remoteIds = new Set(merged.map((m) => m.id).filter(Boolean) as string[]);
  const remoteFingerprints = new Set(
    merged.map((m) => `${m.role}\0${m.content}`)
  );
  for (const m of local) {
    if (m.id && remoteIds.has(m.id)) continue;
    if (remoteFingerprints.has(`${m.role}\0${m.content}`)) continue;
    merged.push(m);
  }

  return merged;
}

/** Assistant body: flat text (no bubble) + clickable → CTAs + source badges */
function AssistantBody({
  content,
  sources,
  isTyping,
  onCta,
}: {
  content: string;
  sources?: ChatSource[];
  isTyping?: boolean;
  onCta: (kind: CtaKind) => void;
}) {
  if (isTyping) {
    return (
      <span className="text-xs text-slate-400 font-roboto italic">typing...</span>
    );
  }

  const cleaned = content
    .replace(/\[\[open_enrollment\]\]/gi, "")
    .replace(
      /\n*\s*For more information[^\n.]*(?:\.|$)/gi,
      ""
    )
    .replace(/\n*\s*you can check\s+snu\.edu\.so[^\n.]*(?:\.|$)/gi, "")
    .trim();

  const parts = parseCtaContent(cleaned);
  const uniqueSources = sources ?? [];

  return (
    <div className="font-roboto text-sm text-slate-800 space-y-3">
      {parts.map((part, i) => {
        if (part.type === "cta") {
          return (
            <div key={`cta-${i}`} className="pt-1">
              <button
                type="button"
                onClick={() => onCta(part.kind)}
                className="group inline-flex items-center gap-1.5 text-left text-sky-600 hover:text-sky-700 font-medium underline-offset-2 hover:underline transition-colors"
              >
                <ArrowRight className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
                <span>{part.label}</span>
              </button>
            </div>
          );
        }
        const text = part.value.trim();
        if (!text) return null;
        return (
          <ReactMarkdown
            key={`md-${i}`}
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
              strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
              a: ({ node, href, children, ...p }) => (
                <a
                  className="text-sky-600 underline underline-offset-2"
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
      })}

      {uniqueSources.length > 0 && (
        <div className="pt-1">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Sources
          </p>
          <div className="flex flex-wrap gap-2">
            {uniqueSources.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-1 pr-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 transition-colors"
                title={s.url}
              >
                <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-sky-100 bg-white">
                  <Image
                    src="/snu-logo.png"
                    alt=""
                    width={14}
                    height={14}
                    className="object-contain"
                  />
                </span>
                <span className="max-w-[10rem] truncate">{s.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}
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
      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors font-roboto flex items-center gap-2 min-w-0 ${
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
  const { toast } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [adminHandoff, setAdminHandoff] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [pending, setPending] = useState(false);
  const [queryConvId, setQueryConvId] = useState<string | null>(null);
  const [convList, setConvList] = useState<ConversationIndexEntry[]>([]);

  const [enrollOpen, setEnrollOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const enrollCtaOffered = useRef(false);
  const pendingRef = useRef(false);
  const adminHandoffRef = useRef(false);
  const indexFingerprintRef = useRef<string>("");

  pendingRef.current = pending;
  adminHandoffRef.current = adminHandoff;

  function notifyConnectedToAdmin() {
    setAdminHandoff(true);
    toast({
      title: "Connected to Admin",
      description: "Someone from the team will follow up shortly.",
      variant: "success",
    });
  }

  const refreshConvList = useCallback(() => {
    setConvList(sortedIndexList());
  }, []);

  const syncFromRemote = useCallback(
    async (id: string, opts?: { replace?: boolean }) => {
      const { messages: remoteRows, meta } = await fetchConversationBundle(id);
      const remote = remoteToChatMessages(remoteRows);
      let merged: ChatMessage[] = remote;

      setMessages((prev) => {
        // Auto-open enrollment when admin kicked it off
        const hadOpenMarker = prev.some(
          (m) =>
            m.role === "assistant" && /\[\[open_enrollment\]\]/i.test(m.content)
        );
        const hasOpenMarker = remote.some(
          (m) =>
            m.role === "assistant" && /\[\[open_enrollment\]\]/i.test(m.content)
        );
        if (hasOpenMarker && !hadOpenMarker) {
          queueMicrotask(() => {
            setEnrollOpen(true);
            setAdminHandoff(false);
          });
        }

        merged = opts?.replace
          ? remote
          : mergeRemoteIntoLocal(prev, remote, pendingRef.current);
        return merged;
      });

      const handedOff = meta?.needs_human === true;
      if (handedOff && !adminHandoffRef.current) {
        notifyConnectedToAdmin();
      } else if (handedOff) {
        setAdminHandoff(true);
      } else if (meta && meta.needs_human === false) {
        // Admin released the thread back to the bot
        setAdminHandoff(false);
      }

      const handoffFlag = handedOff;
      const prev = readIndex()[id];
      const grew = merged.length > (prev?.messageCount ?? 0);
      const dbTitle = meta?.title ?? null;
      indexFingerprintRef.current = `${merged.length}:${merged.map((m) => m.id ?? m.content).join("|")}:${handoffFlag}:${dbTitle ?? ""}`;
      syncIndexMeta(id, merged, handoffFlag, {
        bumpUpdatedAt: grew,
        title: dbTitle,
      });
      refreshConvList();
      return merged.length;
    },
    [toast, refreshConvList]
  );

  /* read ?conversation= from URL on mount */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get("conversation");
    setQueryConvId(q?.trim() || null);
  }, []);

  /* bootstrap: keep only conversation id locally; load messages from DB */
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // Drop legacy local message caches (messages now live in DB)
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (
            key?.startsWith("snubot:conversation_messages:") ||
            key?.startsWith("snubot:conversation_meta:")
          ) {
            keysToRemove.push(key);
          }
        }
        for (const key of keysToRemove) localStorage.removeItem(key);
      } catch {
        /* ignore */
      }

      const reuseId =
        (queryConvId?.trim() || null) ?? readActiveConversationId();

      if (reuseId) {
        if (cancelled) return;
        setActiveConversationId(reuseId);
        setConversationId(reuseId);
        setMessagesLoading(true);
        const cached = readIndex()[reuseId];
        setAdminHandoff(Boolean(cached?.adminHandoff));
        try {
          await syncFromRemote(reuseId, { replace: true });
        } finally {
          if (!cancelled) setMessagesLoading(false);
        }
        return;
      }

      const newId = crypto.randomUUID();
      if (cancelled) return;
      setActiveConversationId(newId);
      upsertIndex({
        conversation_id: newId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: "New conversation",
        messageCount: 0,
        adminHandoff: false,
      });
      setConversationId(newId);
      setMessages([]);
      setMessagesLoading(false);
      setAdminHandoff(false);
      refreshConvList();
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // Only re-bootstrap when the URL conversation id changes — not when sync identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryConvId]);

  /* Keep sidebar titles/counts in sync; never bump order on hydrate/select */
  useEffect(() => {
    if (!conversationId || messagesLoading) return;
    syncIndexMeta(conversationId, messages, adminHandoff, {
      bumpUpdatedAt: false,
    });
    refreshConvList();
  }, [messages, adminHandoff, conversationId, messagesLoading, refreshConvList]);

  /* reload sidebar when conversation changes */
  useEffect(() => {
    refreshConvList();
  }, [conversationId, refreshConvList]);

  /* auto-scroll */
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  /* Poll for new messages (admin replies). Prefer API over anon Realtime — RLS blocks anon reads. */
  useEffect(() => {
    if (!conversationId) return;

    const poll = window.setInterval(() => {
      if (pendingRef.current) return;
      void syncFromRemote(conversationId);
    }, 5_000);

    return () => {
      window.clearInterval(poll);
    };
  }, [conversationId, syncFromRemote]);

  /* ---------------------------------------------------------------- */
  /* Stream                                                             */
  /* ---------------------------------------------------------------- */

  async function streamResponse(
    res: Response
  ): Promise<{
    answer: string;
    connectedToAdmin?: boolean;
    sources?: ChatSource[];
    silent?: boolean;
  }> {
    const ct = res.headers.get("content-type") || "";
    const sourcesHdr =
      res.headers.get("x-snubot-sources") ?? res.headers.get("X-SNUBot-Sources");
    const headerSources = decodeSourcesHeader(sourcesHdr);

    if (!res.ok) {
      const detail = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`Server error (${res.status}): ${detail}`);
    }

    if (!res.body) throw new Error("Empty response body");

    if (!ct.includes("text/event-stream")) {
      const json = await res.json();
      const jsonSources: ChatSource[] = Array.isArray(json?.sources)
        ? json.sources
            .map((s: { url?: string; label?: string; source_url?: string }) => {
              const url = s.url || s.source_url;
              if (!url || typeof url !== "string") return null;
              return {
                url,
                label:
                  typeof s.label === "string" && s.label
                    ? s.label
                    : url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0],
              };
            })
            .filter(Boolean)
        : headerSources;
      return {
        answer: (json?.answer as string | undefined) ?? "",
        connectedToAdmin: json?.needs_human === true,
        sources: jsonSources,
        silent: json?.silent === true || json?.flow === "human_handoff",
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

    return { answer: assistantText, sources: headerSources };
  }

  /* ---------------------------------------------------------------- */
  /* Send                                                               */
  /* ---------------------------------------------------------------- */

  function startEnrollmentFromCta() {
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: enrollmentWelcomeMessage() },
    ]);
    setEnrollOpen(true);
  }

  async function handleCta(kind: CtaKind) {
    if (kind === "enroll") {
      startEnrollmentFromCta();
      return;
    }
    if (kind === "handoff") {
      // Confirm handoff via API the same way as saying "yes"
      if (!conversationId || pending) return;
      setPending(true);
      const history: ChatMessage[] = [
        ...messages,
        { role: "user", content: "Yes, connect me with an admin" },
      ];
      setMessages([...history, { role: "assistant", content: "" }]);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Yes, connect me with an admin",
            conversation_id: conversationId,
            history,
            stream: false,
          }),
        });
        const { answer, connectedToAdmin } = await streamResponse(res);
        if (connectedToAdmin || /connected you with an admin/i.test(answer)) {
          notifyConnectedToAdmin();
        } else {
          setAdminHandoff(true);
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = {
              role: "assistant",
              content: answer || "I've connected you with an admin.",
            };
          }
          return next;
        });
      } catch {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = {
              role: "assistant",
              content: "Sorry — could not reach an admin right now. Please try again.",
            };
          }
          return next;
        });
      } finally {
        setPending(false);
        pendingRef.current = false;
        if (conversationId) void syncFromRemote(conversationId);
      }
    }
  }

  async function handleSend(text?: string) {
    if (!conversationId) return;
    const msg = (text ?? inputValue).trim();
    if (!msg || pending) return;

    setPending(true);
    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    const history: ChatMessage[] = [
      ...messages.filter((m) => m.role === "user" || m.role === "assistant"),
      { role: "user", content: msg },
    ];
    const humanOnly = adminHandoffRef.current;
    const optimistic: ChatMessage[] = humanOnly
      ? [...messages, { role: "user", content: msg }]
      : [
          ...messages,
          { role: "user", content: msg },
          { role: "assistant", content: "" },
        ];
    setMessages(optimistic);
    if (conversationId) {
      syncIndexMeta(conversationId, optimistic, adminHandoff, {
        bumpUpdatedAt: true,
      });
      refreshConvList();
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 20_000);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          conversation_id: conversationId,
          history,
          // Human-handoff threads don't need streaming
          stream: !humanOnly,
        }),
        signal: controller.signal,
      });

      let { answer, connectedToAdmin, sources, silent } =
        await streamResponse(res);

      if (
        connectedToAdmin ||
        silent ||
        /connected you with an admin/i.test(answer || "")
      ) {
        if (!adminHandoffRef.current) notifyConnectedToAdmin();
        else setAdminHandoff(true);
      }

      // Strict handoff: message logged, no bot bubble
      if (silent || (connectedToAdmin && !answer?.trim())) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content.trim()) next.pop();
          return next;
        });
        return;
      }

      // After 3 consecutive faculty questions, offer enrollment CTA (clickable)
      const userMsgs = history.filter((m) => m.role === "user").map((m) => m.content);
      const cta = shouldOfferEnrollmentCta(userMsgs, enrollCtaOffered.current);
      if (cta && answer) {
        answer += enrollmentCtaMessage(cta.faculty);
        enrollCtaOffered.current = true;
      }

      if (answer) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            const next = [...prev];
            next[next.length - 1] = {
              role: "assistant",
              content: answer,
              sources: sources?.length ? sources : undefined,
            };
            return next;
          }
          return [
            ...prev,
            {
              role: "assistant",
              content: answer,
              sources: sources?.length ? sources : undefined,
            },
          ];
        });
      } else {
        // No answer — drop empty assistant placeholder
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content.trim()) next.pop();
          return next;
        });
      }
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message));

      if (isTimeout) {
        // Drop the optimistic user + empty assistant turn; restore question for retry
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content.trim()) next.pop();
          const user = next[next.length - 1];
          if (user?.role === "user" && user.content === msg) next.pop();
          return next;
        });
        setInputValue(msg);
        requestAnimationFrame(() => {
          const el = inputRef.current;
          if (!el) return;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        });
        toast({
          title: "Request timed out",
          description: "Your question is back in the input — send again when ready.",
          variant: "error",
        });
      } else {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          const placeholder = last?.role === "assistant" && !last.content.trim();
          const errorMsg = "Sorry — something went wrong, please try again.";
          if (placeholder) {
            next[next.length - 1] = { role: "assistant", content: errorMsg };
          } else {
            next.push({ role: "assistant", content: errorMsg });
          }
          return next;
        });
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setPending(false);
      pendingRef.current = false;
      if (conversationId) void syncFromRemote(conversationId);
      inputRef.current?.focus();
    }
  }

  /* ---------------------------------------------------------------- */
  /* New chat / switch                                                  */
  /* ---------------------------------------------------------------- */

  function startNewChat() {
    const newId = crypto.randomUUID();
    setActiveConversationId(newId);
    upsertIndex({
      conversation_id: newId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: "New conversation",
      messageCount: 0,
      adminHandoff: false,
    });
    indexFingerprintRef.current = "";
    setConversationId(newId);
    setMessages([]);
    setMessagesLoading(false);
    setAdminHandoff(false);
    setInputValue("");
    setSidebarOpen(false);
    enrollCtaOffered.current = false;
    refreshConvList();
    router.push("/");
  }

  function switchConversation(id: string) {
    if (id === conversationId) {
      setSidebarOpen(false);
      return;
    }
    setActiveConversationId(id);
    setConversationId(id);
    setMessagesLoading(true);
    setAdminHandoff(Boolean(readIndex()[id]?.adminHandoff));
    setSidebarOpen(false);
    indexFingerprintRef.current = "";
    router.push(`/?conversation=${encodeURIComponent(id)}`);
    void (async () => {
      try {
        await syncFromRemote(id, { replace: true });
      } finally {
        setMessagesLoading(false);
      }
    })();
  }

  const isEmpty = !messagesLoading && messages.length === 0;

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
            <p className="text-[10px] text-slate-400 font-roboto leading-tight truncate">
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
            className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-600 transition-colors font-roboto"
          >
            <Plus className="w-4 h-4" />
            New chat
          </button>
        </div>

        {/* ── Conversation list ── */}
        <div className="flex-1 overflow-y-auto px-3 py-1">
          <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-widest font-roboto">
            Your conversations
          </p>
          {convList.length === 0 ? (
            <p className="px-2 py-3 text-xs text-slate-400 font-roboto">No conversations yet.</p>
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
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 font-roboto"
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
          {messagesLoading ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center">
              <p className="flex items-center gap-2 text-sm text-slate-500 font-roboto">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading conversation…
              </p>
            </div>
          ) : isEmpty ? (
            /* ── Welcome screen ── */
            <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
              {/* logo pill */}
              <div className="mb-4 flex items-center gap-3 px-5 py-2 rounded-full bg-white border border-gray-200 shadow-sm">
                <div className="w-8 h-8 rounded-full overflow-hidden border border-sky-200 bg-white flex items-center justify-center">
                  <Image src="/snu-logo.png" alt="SNU" width={20} height={20} className="object-contain w-[62%] h-[62%]" />
                </div>
                <span className="font-bebas text-xl tracking-wide text-slate-800">SNUBOT</span>
              </div>

              <h1 className="font-roboto text-3xl font-bold text-slate-900 mb-2">
                How can I help you today?
              </h1>
              <p className="font-roboto text-sm text-slate-500 mb-8">
                Ask about programs, admissions, fees, or enrollment at SNU.
              </p>

              {/* 6 cards — 2 per row */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUGGESTION_CARDS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setInputValue(label);
                      requestAnimationFrame(() => {
                        const el = inputRef.current;
                        if (!el) return;
                        el.focus();
                        el.style.height = "auto";
                        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                      });
                    }}
                    className="group flex items-center justify-between gap-3 rounded-xl bg-white border border-gray-200 px-4 py-4 text-left hover:border-sky-300 hover:shadow-sm transition-all"
                  >
                    <span className="font-roboto text-sm text-slate-700">{label}</span>
                    <ArrowRight className="shrink-0 w-4 h-4 text-slate-400 group-hover:text-sky-500 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Chat messages ── */
            <div className="max-w-2xl mx-auto flex flex-col gap-5">
              {adminHandoff && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-roboto">
                  This conversation has been passed to an admin.
                </div>
              )}

              {messages.map((m, idx) => {
                const isLastAssistant =
                  m.role === "assistant" && idx === messages.length - 1;
                const isTyping = isLastAssistant && pending && !m.content.trim();
                const isUser = m.role === "user";
                const isAdmin = m.role === "admin";

                return (
                  <div
                    key={m.id ?? `${idx}-${m.role}`}
                    className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                  >
                    {isAdmin ? (
                      <AdminAvatar />
                    ) : m.role === "assistant" ? (
                      <BotAvatar />
                    ) : (
                      <UserAvatar />
                    )}

                    <div
                      className={`max-w-[85%] flex flex-col gap-1 ${
                        isUser ? "items-end" : "items-start"
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-slate-400 font-roboto px-0.5">
                        {isAdmin ? "Admin" : m.role === "assistant" ? "SNUBot" : "You"}
                      </span>

                      {isUser ? (
                        <div className="rounded-2xl rounded-tr-sm bg-sky-500 px-4 py-3 text-sm text-white">
                          <span className="font-roboto">{m.content}</span>
                        </div>
                      ) : isAdmin ? (
                        <div className="rounded-2xl rounded-tl-sm bg-sky-600 px-4 py-3 text-sm text-white font-roboto">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ node, ...p }) => (
                                <p className="mb-2 last:mb-0 leading-relaxed whitespace-pre-wrap" {...p} />
                              ),
                              strong: ({ node, ...p }) => (
                                <strong className="font-semibold" {...p} />
                              ),
                            }}
                          >
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <AssistantBody
                          content={m.content}
                          sources={m.sources}
                          isTyping={isTyping}
                          onCta={handleCta}
                        />
                      )}
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
            />

            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex items-end gap-2 bg-white rounded-[1.75rem] border border-gray-200 shadow-sm px-3 py-2"
            >
              <textarea
                ref={inputRef}
                rows={1}
                className="flex-1 max-h-40 resize-none overflow-y-auto bg-transparent px-1 py-1.5 text-sm text-slate-800 placeholder-slate-400 outline-none font-roboto leading-5"
                placeholder="What's in your mind..."
                value={inputValue}
                disabled={pending || messagesLoading || !conversationId}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                type="submit"
                disabled={pending || messagesLoading || !conversationId || !inputValue.trim()}
                className="shrink-0 mb-0.5 w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-white disabled:opacity-50 hover:bg-sky-600 transition-colors"
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
