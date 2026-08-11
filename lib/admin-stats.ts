import { getSupabase } from "@/lib/supabase";

export type EnrollmentStatusBreakdown = {
  in_progress: number;
  pending_review: number;
  approved: number;
  rejected: number;
  other: number;
};

export type TrafficPoint = {
  date: string; // YYYY-MM-DD
  count: number;
};

export type AdminDashboardStats = {
  chats: number;
  studentsServed: number;
  enrollments: number;
  enrollmentByStatus: EnrollmentStatusBreakdown;
  timeSavedMinutes: number;
  timeSavedLabel: string;
  traffic: TrafficPoint[];
  trafficGranularity: "day" | "hour";
};

function formatTimeSaved(studentsServed: number): {
  minutes: number;
  label: string;
} {
  const minutes = studentsServed * 15;
  if (minutes < 60) {
    return {
      minutes,
      label: `${studentsServed} student${studentsServed === 1 ? "" : "s"} served ≈ ${minutes} min saved`,
    };
  }
  const hours = minutes / 60;
  const hoursLabel =
    hours >= 10 ? hours.toFixed(0) : hours.toFixed(hours % 1 === 0 ? 0 : 1);
  return {
    minutes,
    label: `${studentsServed} student${studentsServed === 1 ? "" : "s"} served ≈ ${hoursLabel} hours saved`,
  };
}

function hourKeyFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:00`;
}

function hourKey(iso: string): string {
  // YYYY-MM-DD HH:00 (UTC, matches ISO timestamps from Supabase)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:00`;
  }
  return hourKeyFromDate(d);
}

/** Last 24 UTC hours as empty buckets (oldest → newest). */
function last24HourBuckets(now = new Date()): Map<string, number> {
  const bucket = new Map<string, number>();
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  for (let i = 23; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 60 * 60 * 1000);
    bucket.set(hourKeyFromDate(d), 0);
  }
  return bucket;
}

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    chatsRes,
    ipsRes,
    studentsRes,
    trafficRes,
  ] = await Promise.all([
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("conversations")
      .select("ip_address")
      .not("ip_address", "is", null),
    supabase.from("students").select("id, enrollment_status"),
    supabase
      .from("conversations")
      .select("created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true }),
  ]);

  if (chatsRes.error) throw new Error(chatsRes.error.message);
  if (ipsRes.error) throw new Error(ipsRes.error.message);
  if (studentsRes.error) throw new Error(studentsRes.error.message);
  if (trafficRes.error) throw new Error(trafficRes.error.message);

  const chats = chatsRes.count ?? 0;

  const distinctIps = new Set<string>();
  for (const row of ipsRes.data ?? []) {
    const ip = (row.ip_address as string | null)?.trim();
    if (ip) distinctIps.add(ip);
  }
  const studentsServed = distinctIps.size;

  const enrollmentByStatus: EnrollmentStatusBreakdown = {
    in_progress: 0,
    pending_review: 0,
    approved: 0,
    rejected: 0,
    other: 0,
  };
  for (const row of studentsRes.data ?? []) {
    const s = String(row.enrollment_status ?? "")
      .trim()
      .toLowerCase();
    if (s === "in_progress" || s === "in-progress") enrollmentByStatus.in_progress += 1;
    else if (s === "pending_review" || s === "pending")
      enrollmentByStatus.pending_review += 1;
    else if (s === "approved") enrollmentByStatus.approved += 1;
    else if (s === "rejected") enrollmentByStatus.rejected += 1;
    else enrollmentByStatus.other += 1;
  }
  const enrollments = studentsRes.data?.length ?? 0;

  const { minutes, label } = formatTimeSaved(studentsServed);

  const trafficGranularity = "hour" as const;
  const bucket = last24HourBuckets();
  for (const row of trafficRes.data ?? []) {
    const iso = row.created_at as string | undefined;
    if (!iso) continue;
    const key = hourKey(iso);
    if (bucket.has(key)) {
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    } else {
      // Edge hour just outside the prefilled window
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }
  }

  const traffic: TrafficPoint[] = [...bucket.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-24);

  return {
    chats,
    studentsServed,
    enrollments,
    enrollmentByStatus,
    timeSavedMinutes: minutes,
    timeSavedLabel: label,
    traffic,
    trafficGranularity,
  };
}
