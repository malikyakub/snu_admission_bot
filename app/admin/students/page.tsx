"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import { Loader2, MessageSquare, RefreshCw, Search } from "lucide-react";
import { format, parseISO } from "date-fns";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ADMIN_ENROLLMENT_STATUSES,
  type AdminStudentDetail,
  type AdminStudentListItem,
  type AdminStudentPatch,
} from "@/lib/admin-students";
import {
  ALL_FACULTIES,
  allowedFaculties,
  EXAM_LOCATIONS,
  FACULTY_CHOICE_TIER1_NOTE,
  formatPaymentPendingLabel,
  TOTAL_ENROLLMENT_STEPS,
  type Faculty,
} from "@/lib/enrollment";
import { formatEnrollmentStatusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

function facultyOptionsForSlot(
  slot: 1 | 2 | 3,
  earlier: string[],
  currentValue: string
): string[] {
  const base =
    slot === 1
      ? [...ALL_FACULTIES]
      : allowedFaculties(earlier.filter(Boolean), slot);
  // Keep a legacy saved value visible without rewriting the DB row
  if (currentValue && !base.includes(currentValue as Faculty)) {
    return [currentValue, ...base];
  }
  return base;
}

type StatusFilter =
  | "all"
  | "pending_review"
  | "in_progress"
  | "approved"
  | "rejected";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending_review", label: "Under review" },
  { key: "in_progress", label: "In progress" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

const POSITIVE_STATUSES = new Set(["approved", "accepted", "enrolled"]);

type DraftFields = {
  full_name: string;
  mothers_name: string;
  gender: string;
  date_of_birth: string;
  place_of_birth: string;
  national_id: string;
  nationality: string;
  region: string;
  address: string;
  school_name: string;
  school_country: string;
  school_region_city: string;
  exam_roll_number: string;
  certificate_number: string;
  faculty_choice_1: string;
  faculty_choice_2: string;
  faculty_choice_3: string;
  guardian_name: string;
  guardian_mobile: string;
  guardian_relation: string;
  exam_location: string;
  enrollment_status: string;
};

const EMPTY_DRAFT: DraftFields = {
  full_name: "",
  mothers_name: "",
  gender: "",
  date_of_birth: "",
  place_of_birth: "",
  national_id: "",
  nationality: "",
  region: "",
  address: "",
  school_name: "",
  school_country: "",
  school_region_city: "",
  exam_roll_number: "",
  certificate_number: "",
  faculty_choice_1: "",
  faculty_choice_2: "",
  faculty_choice_3: "",
  guardian_name: "",
  guardian_mobile: "",
  guardian_relation: "",
  exam_location: "",
  enrollment_status: "pending_review",
};

async function authHeaders(): Promise<HeadersInit | null> {
  if (!supabaseReady || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

function formatUpdated(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return format(parseISO(raw), "MMM d, yyyy · h:mm a");
  } catch {
    return raw;
  }
}

function statusBadgeClass(status: string | null | undefined): string {
  const key = (status || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "pending_review" || key === "under_review" || key === "submitted") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }
  if (key === "approved" || key === "accepted" || key === "enrolled") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  }
  if (key === "rejected" || key === "declined") {
    return "bg-rose-50 text-rose-800 ring-rose-200";
  }
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function normalizeAdminStatus(raw: string | null | undefined): string {
  const key = (raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ADMIN_ENROLLMENT_STATUSES as readonly string[]).includes(key)) return key;
  if (
    key === "under_review" ||
    key === "pending" ||
    key === "submitted" ||
    key === "in_review"
  ) {
    return "pending_review";
  }
  if (key === "draft" || key === "started" || key === "incomplete" || !key) {
    return "in_progress";
  }
  if (key === "accepted" || key === "enrolled") return "approved";
  if (key === "declined") return "rejected";
  return "pending_review";
}

function draftFromStudent(s: AdminStudentDetail): DraftFields {
  return {
    full_name: s.full_name || "",
    mothers_name: s.mothers_name || "",
    gender: s.gender || "",
    date_of_birth: s.date_of_birth || "",
    place_of_birth: s.place_of_birth || "",
    national_id: s.national_id || "",
    nationality: s.nationality || "",
    region: s.region || "",
    address: s.address || "",
    school_name: s.school_name || "",
    school_country: s.school_country || "",
    school_region_city: s.school_region_city || "",
    exam_roll_number: s.exam_roll_number || "",
    certificate_number: s.certificate_number || "",
    faculty_choice_1: s.faculty_choice_1 || "",
    faculty_choice_2: s.faculty_choice_2 || "",
    faculty_choice_3: s.faculty_choice_3 || "",
    guardian_name: s.guardian_name || "",
    guardian_mobile: s.guardian_mobile || "",
    guardian_relation: s.guardian_relation || "",
    exam_location: s.exam_location || "",
    enrollment_status: normalizeAdminStatus(s.enrollment_status),
  };
}

function looksLikeImageUrl(url: string): boolean {
  if (/^blob:/i.test(url)) return false;
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url)) return true;
  if (/\/enrollment-photos\//i.test(url)) return true;
  return false;
}

const ghostInputClass =
  "h-8 w-full rounded-none border-0 border-b border-transparent bg-transparent px-0 text-sm text-slate-800 shadow-none outline-none transition-[border-color] placeholder:text-slate-300 hover:border-slate-300 focus:border-sky-500 focus-visible:ring-0 disabled:cursor-default disabled:opacity-100";

function GhostField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <input
        ref={ref}
        value={value}
        readOnly={!editing}
        placeholder="—"
        onClick={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={cn(ghostInputClass, editing && "border-sky-500")}
      />
    </div>
  );
}

function GhostSelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder,
  highlight,
  fieldRef,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: readonly string[];
  placeholder: string;
  highlight?: boolean;
  fieldRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={fieldRef} className="min-w-0 group/field">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
        <SelectTrigger
          className={cn(
            "h-8 w-full rounded-none border-0 border-b border-transparent bg-transparent px-0 shadow-none outline-none",
            "hover:border-slate-300 data-[popup-open]:border-sky-500",
            "focus-visible:border-sky-500 focus-visible:ring-0",
            "[&_svg]:opacity-0 group-hover/field:[&_svg]:opacity-100 data-[popup-open]:[&_svg]:opacity-100",
            highlight && "border-sky-400 bg-sky-50/40 px-1.5",
            !value && "text-slate-300"
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusGhostSelect({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0 group/status">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        Status
      </p>
      <Select value={value} onValueChange={(v) => onValueChange(v ?? "")}>
        <SelectTrigger
          className={cn(
            "h-8 w-full rounded-none border-0 border-b border-transparent bg-transparent px-0 shadow-none",
            "hover:border-slate-300 data-[popup-open]:border-sky-500",
            "focus-visible:border-sky-500 focus-visible:ring-0",
            "[&_svg]:opacity-0 group-hover/status:[&_svg]:opacity-100 data-[popup-open]:[&_svg]:opacity-100"
          )}
        >
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
              statusBadgeClass(value)
            )}
          >
            {formatEnrollmentStatusLabel(value)}
          </span>
        </SelectTrigger>
        <SelectContent>
          {ADMIN_ENROLLMENT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {formatEnrollmentStatusLabel(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DocCard({
  label,
  url,
}: {
  label: string;
  url: string | null | undefined;
}) {
  const href = (url || "").trim();
  if (!href) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 text-center">
        <p className="text-[11px] font-medium text-slate-600">{label}</p>
        <p className="mt-0.5 text-[10px] text-slate-400">Not uploaded</p>
      </div>
    );
  }

  if (/^blob:/i.test(href)) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2 text-center">
        <p className="text-[11px] font-medium text-slate-700">{label}</p>
        <p className="mt-0.5 text-[10px] text-amber-700">
          Unavailable — re-upload required
        </p>
      </div>
    );
  }

  const isImage = looksLikeImageUrl(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={href}
          alt={label}
          className="h-full w-full object-cover transition group-hover:scale-[1.02]"
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
          <p className="text-[11px] font-medium text-slate-700">{label}</p>
          <p className="truncate text-[10px] text-sky-600">Open file</p>
        </div>
      )}
      {isImage && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4">
          <p className="truncate text-[10px] font-medium text-white">{label}</p>
        </div>
      )}
    </a>
  );
}

export default function AdminStudentsPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [students, setStudents] = useState<AdminStudentListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detail, setDetail] = useState<AdminStudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [highlightPlacement, setHighlightPlacement] = useState(false);

  const sheetScrollRef = useRef<HTMLDivElement>(null);
  const placementRef = useRef<HTMLDivElement>(null);
  const campusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Not signed in.");
      const params = new URLSearchParams();
      params.set("status", filter);
      if (debouncedQ) params.set("q", debouncedQ);
      params.set("limit", "150");
      const res = await fetch(`/api/admin/students?${params}`, { headers });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        students?: AdminStudentListItem[];
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load students");
      }
      setStudents(json.students || []);
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Failed to load students",
        variant: "error",
      });
      setStudents([]);
    } finally {
      setListLoading(false);
    }
  }, [filter, debouncedQ, toast]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setHighlightPlacement(false);
      try {
        const headers = await authHeaders();
        if (!headers) throw new Error("Not signed in.");
        const res = await fetch(`/api/admin/students/${id}`, { headers });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          student?: AdminStudentDetail;
        };
        if (!res.ok || !json.ok || !json.student) {
          throw new Error(json.error || "Failed to load student");
        }
        setDetail(json.student);
        setDraft(draftFromStudent(json.student));
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : "Failed to load student",
          variant: "error",
        });
        setDetail(null);
        setDraft(EMPTY_DRAFT);
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!sheetOpen || !selectedId) return;
    void loadDetail(selectedId);
  }, [sheetOpen, selectedId, loadDetail]);

  function openStudent(id: string) {
    setSelectedId(id);
    setSheetOpen(true);
  }

  function setField<K extends keyof DraftFields>(key: K, value: DraftFields[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function scrollToPlacement() {
    window.setTimeout(() => {
      placementRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightPlacement(true);
      window.setTimeout(() => setHighlightPlacement(false), 2200);
    }, 80);
  }

  function handleStatusChange(next: string) {
    setField("enrollment_status", next);
    if (POSITIVE_STATUSES.has(next)) {
      scrollToPlacement();
    }
  }

  const baseline = useMemo(
    () => (detail ? draftFromStudent(detail) : null),
    [detail]
  );

  const dirty = useMemo(() => {
    if (!baseline) return false;
    return (Object.keys(draft) as (keyof DraftFields)[]).some(
      (k) => (draft[k] || "") !== (baseline[k] || "")
    );
  }, [draft, baseline]);

  async function saveDetail() {
    if (!selectedId || !detail || saving || !dirty) return;
    setSaving(true);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Not signed in.");
      const body: AdminStudentPatch = { ...draft };
      const res = await fetch(`/api/admin/students/${selectedId}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        student?: AdminStudentDetail;
      };
      if (!res.ok || !json.ok || !json.student) {
        throw new Error(json.error || "Save failed");
      }
      setDetail(json.student);
      setDraft(draftFromStudent(json.student));
      setStudents((prev) =>
        prev.map((s) =>
          s.id === json.student!.id
            ? {
                ...s,
                full_name: json.student!.full_name,
                exam_location: json.student!.exam_location,
                enrollment_status: json.student!.enrollment_status,
                payment_method: json.student!.payment_method,
                doc_payment_url: json.student!.doc_payment_url,
                faculty_choice_1: json.student!.faculty_choice_1,
                updated_at: json.student!.updated_at,
              }
            : s
        )
      );
      toast({ title: "Student updated", variant: "success" });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Save failed",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 font-roboto">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Students
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review enrollment applications, set exam location, and update status.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200/80">
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="flex w-full max-w-full flex-wrap items-center gap-2 md:w-1/2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, phone, faculty…"
                className="h-9 pl-8 text-sm"
              />
            </div>
            <Select
              value={filter}
              onValueChange={(v) => setFilter((v as StatusFilter) || "all")}
            >
              <SelectTrigger className="h-9 w-[9.5rem] shrink-0 sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => void loadList()}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs text-slate-500 hover:bg-slate-100"
              title="Refresh"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", listLoading && "animate-spin")}
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {listLoading && students.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading students…
            </div>
          ) : students.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-slate-500">
              No students match this filter.
            </p>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-white">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>1st faculty</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow
                    key={s.id}
                    data-state={selectedId === s.id && sheetOpen ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={() => openStudent(s.id)}
                  >
                    <TableCell className="max-w-[14rem] truncate font-medium">
                      {s.full_name?.trim() || "Unnamed applicant"}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {s.phone || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                            statusBadgeClass(s.enrollment_status)
                          )}
                        >
                          {formatEnrollmentStatusLabel(s.enrollment_status)}
                        </span>
                        {formatPaymentPendingLabel(s) ? (
                          <span className="inline-flex rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-800 ring-1 ring-inset ring-orange-200">
                            Pending payment
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-slate-600">
                      {s.faculty_choice_1 || "—"}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {Math.min(s.enrollment_step ?? 0, TOTAL_ENROLLMENT_STEPS)}
                      /{TOTAL_ENROLLMENT_STEPS}
                    </TableCell>
                    <TableCell className="text-slate-500">
                      {formatUpdated(s.updated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setHighlightPlacement(false);
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 bg-white p-0 sm:max-w-lg"
        >
          <SheetHeader className="border-b border-slate-100 pr-12">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <SheetTitle className="truncate font-roboto text-slate-900">
                  {detail?.full_name?.trim() ||
                    (detailLoading ? "Loading…" : "Applicant")}
                </SheetTitle>
                <SheetDescription className="font-roboto">
                  {detail?.phone || "Enrollment details"}
                </SheetDescription>
              </div>
              {detail?.conversation_id && (
                <Link
                  href={`/admin/chats/${detail.conversation_id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat
                </Link>
              )}
            </div>
          </SheetHeader>

          <div
            ref={sheetScrollRef}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4"
          >
            {detailLoading && !detail ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading application…
              </div>
            ) : !detail ? (
              <p className="py-12 text-center text-sm text-slate-500">
                Could not load this student.
              </p>
            ) : (
              <>
                <section className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <StatusGhostSelect
                    value={draft.enrollment_status}
                    onValueChange={handleStatusChange}
                  />
                </section>

                <section
                  ref={placementRef}
                  className={cn(
                    "space-y-3 rounded-lg p-3 transition-colors",
                    highlightPlacement
                      ? "bg-sky-50 ring-1 ring-sky-200"
                      : "bg-transparent"
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Placement
                  </p>
                  <div className="grid gap-3">
                    <GhostSelectField
                      label="Exam location"
                      value={draft.exam_location}
                      onValueChange={(v) => setField("exam_location", v)}
                      options={EXAM_LOCATIONS}
                      placeholder="Set exam location"
                      highlight={highlightPlacement}
                      fieldRef={campusRef}
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Payment
                  </p>
                  <div className="grid gap-2">
                    <p className="text-sm text-slate-700">
                      {formatPaymentPendingLabel(detail) ||
                        (detail.doc_payment_url
                          ? "Payment receipt on file"
                          : "No payment choice yet")}
                    </p>
                    <p className="text-xs text-slate-500">
                      Method:{" "}
                      {detail.payment_method === "office_delivery"
                        ? "Office delivery"
                        : detail.payment_method === "bank_receipt"
                          ? "Bank receipt"
                          : "—"}
                      {detail.bank_reference_number
                        ? ` · Ref: ${detail.bank_reference_number}`
                        : ""}
                    </p>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Personal
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <GhostField
                      label="Full name"
                      value={draft.full_name}
                      onChange={(v) => setField("full_name", v)}
                    />
                    <GhostField
                      label="Mother's name"
                      value={draft.mothers_name}
                      onChange={(v) => setField("mothers_name", v)}
                    />
                    <GhostField
                      label="Gender"
                      value={draft.gender}
                      onChange={(v) => setField("gender", v)}
                    />
                    <GhostField
                      label="Date of birth"
                      value={draft.date_of_birth}
                      onChange={(v) => setField("date_of_birth", v)}
                    />
                    <GhostField
                      label="Place of birth"
                      value={draft.place_of_birth}
                      onChange={(v) => setField("place_of_birth", v)}
                    />
                    <GhostField
                      label="National ID"
                      value={draft.national_id}
                      onChange={(v) => setField("national_id", v)}
                    />
                    <GhostField
                      label="Nationality"
                      value={draft.nationality}
                      onChange={(v) => setField("nationality", v)}
                    />
                    <GhostField
                      label="Region"
                      value={draft.region}
                      onChange={(v) => setField("region", v)}
                    />
                    <GhostField
                      className="col-span-2"
                      label="Address"
                      value={draft.address}
                      onChange={(v) => setField("address", v)}
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    School &amp; exam
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <GhostField
                      label="School"
                      value={draft.school_name}
                      onChange={(v) => setField("school_name", v)}
                    />
                    <GhostField
                      label="Country"
                      value={draft.school_country}
                      onChange={(v) => setField("school_country", v)}
                    />
                    <GhostField
                      label="City / region"
                      value={draft.school_region_city}
                      onChange={(v) => setField("school_region_city", v)}
                    />
                    <GhostField
                      label="Exam roll #"
                      value={draft.exam_roll_number}
                      onChange={(v) => setField("exam_roll_number", v)}
                    />
                    <GhostField
                      label="Certificate #"
                      value={draft.certificate_number}
                      onChange={(v) => setField("certificate_number", v)}
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Faculty choices
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {FACULTY_CHOICE_TIER1_NOTE}
                  </p>
                  <div className="grid gap-3">
                    <GhostSelectField
                      label="1st choice"
                      value={draft.faculty_choice_1}
                      onValueChange={(v) => {
                        setDraft((prev) => {
                          const next1 = v;
                          let next2 = prev.faculty_choice_2;
                          let next3 = prev.faculty_choice_3;
                          if (
                            next2 &&
                            !allowedFaculties([next1].filter(Boolean), 2).includes(
                              next2 as Faculty
                            )
                          ) {
                            next2 = "";
                          }
                          if (
                            next3 &&
                            !allowedFaculties(
                              [next1, next2].filter(Boolean),
                              3
                            ).includes(next3 as Faculty)
                          ) {
                            next3 = "";
                          }
                          return {
                            ...prev,
                            faculty_choice_1: next1,
                            faculty_choice_2: next2,
                            faculty_choice_3: next3,
                          };
                        });
                      }}
                      options={facultyOptionsForSlot(
                        1,
                        [],
                        draft.faculty_choice_1
                      )}
                      placeholder="Select first choice"
                    />
                    <GhostSelectField
                      label="2nd choice"
                      value={draft.faculty_choice_2}
                      onValueChange={(v) => {
                        setDraft((prev) => {
                          const next2 = v;
                          let next3 = prev.faculty_choice_3;
                          if (
                            next3 &&
                            !allowedFaculties(
                              [prev.faculty_choice_1, next2].filter(Boolean),
                              3
                            ).includes(next3 as Faculty)
                          ) {
                            next3 = "";
                          }
                          return {
                            ...prev,
                            faculty_choice_2: next2,
                            faculty_choice_3: next3,
                          };
                        });
                      }}
                      options={facultyOptionsForSlot(
                        2,
                        [draft.faculty_choice_1],
                        draft.faculty_choice_2
                      )}
                      placeholder="Select second choice"
                    />
                    <GhostSelectField
                      label="3rd choice"
                      value={draft.faculty_choice_3}
                      onValueChange={(v) => setField("faculty_choice_3", v)}
                      options={facultyOptionsForSlot(
                        3,
                        [draft.faculty_choice_1, draft.faculty_choice_2],
                        draft.faculty_choice_3
                      )}
                      placeholder="Select third choice"
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Guardian
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <GhostField
                      label="Name"
                      value={draft.guardian_name}
                      onChange={(v) => setField("guardian_name", v)}
                    />
                    <GhostField
                      label="Mobile"
                      value={draft.guardian_mobile}
                      onChange={(v) => setField("guardian_mobile", v)}
                    />
                    <GhostField
                      label="Relation"
                      value={draft.guardian_relation}
                      onChange={(v) => setField("guardian_relation", v)}
                    />
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Documents
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <DocCard label="Photo" url={detail.doc_photo_url} />
                    <DocCard label="ID" url={detail.doc_id_url} />
                    <DocCard label="Certificate" url={detail.doc_certificate_url} />
                    <DocCard label="Payment" url={detail.doc_payment_url} />
                  </div>
                </section>
              </>
            )}
          </div>

          {detail && (
            <SheetFooter className="border-t border-slate-100">
              <Button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void saveDetail()}
                className="w-full bg-sky-600 text-white hover:bg-sky-700"
              >
                {saving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
