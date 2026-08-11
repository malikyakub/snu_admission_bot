"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { format, parse } from "date-fns";
import {
  MessageSquare,
  Users,
  FileCheck2,
  Clock3,
  Loader2,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { RecentChatsPanel } from "@/components/RecentChatsPanel";
import { supabase, supabaseReady } from "@/app/_lib/supabaseClient";
import type { AdminDashboardStats } from "@/lib/admin-stats";

const trafficChartConfig = {
  count: {
    label: "Chats opened",
    color: "hsl(199 89% 48%)",
  },
} satisfies ChartConfig;

function parseTrafficDate(
  value: string,
  granularity: "day" | "hour"
): Date | null {
  try {
    if (granularity === "hour") {
      // Buckets are UTC hour keys: "YYYY-MM-DD HH:00"
      const d = new Date(`${value.replace(" ", "T")}:00.000Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = parse(value, "yyyy-MM-dd", new Date());
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function formatTrafficTick(
  value: string,
  granularity: "day" | "hour"
): string {
  const d = parseTrafficDate(value, granularity);
  if (!d) return value;
  // Hour ticks: compact clock time in local TZ
  return granularity === "hour" ? format(d, "ha") : format(d, "MMM d");
}

function formatTrafficLabel(
  value: string,
  granularity: "day" | "hour"
): string {
  const d = parseTrafficDate(value, granularity);
  if (!d) return value;
  return granularity === "hour"
    ? format(d, "MMM d, yyyy · h:mm a")
    : format(d, "EEE, MMM d, yyyy");
}

function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card className="bg-white shadow-sm ring-slate-200/80">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1">
          <CardDescription className="text-slate-500">{title}</CardDescription>
          <CardTitle className="text-3xl font-semibold tracking-tight text-slate-900">
            {value}
          </CardTitle>
        </div>
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-md ${accent}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardHeader>
      {hint ? (
        <CardContent>
          <p className="text-xs leading-relaxed text-slate-500">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function enrollmentHint(stats: AdminDashboardStats): string {
  const b = stats.enrollmentByStatus;
  const parts = [
    b.in_progress ? `${b.in_progress} in progress` : null,
    b.pending_review ? `${b.pending_review} under review` : null,
    b.approved ? `${b.approved} approved` : null,
    b.rejected ? `${b.rejected} rejected` : null,
    b.other ? `${b.other} other` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No enrollment rows yet";
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabaseReady || !supabase) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("Not signed in.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/admin/stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as {
          ok?: boolean;
          stats?: AdminDashboardStats;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.stats) {
          setError(json.error || "Failed to load dashboard stats.");
        } else {
          setStats(json.stats);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stats.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = useMemo(() => stats?.traffic ?? [], [stats]);
  const granularity = stats?.trafficGranularity ?? "day";

  return (
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <div className="shrink-0">
          <h1 className="font-roboto text-2xl font-semibold tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-roboto">
            Overview of chats, reach, enrollments, and estimated time saved.
          </p>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-slate-600 font-roboto">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading stats…
          </p>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : stats ? (
          <>
            <div className="grid shrink-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                title="Chats"
                value={stats.chats}
                hint="Total conversations"
                icon={MessageSquare}
                accent="bg-sky-50 text-sky-700"
              />
              <StatCard
                title="Students served"
                value={stats.studentsServed}
                hint="Distinct visitor IPs"
                icon={Users}
                accent="bg-emerald-50 text-emerald-700"
              />
              <StatCard
                title="Enrollments"
                value={stats.enrollments}
                hint={enrollmentHint(stats)}
                icon={FileCheck2}
                accent="bg-amber-50 text-amber-700"
              />
              <StatCard
                title="Time saved"
                value={
                  stats.timeSavedMinutes >= 60
                    ? `${(stats.timeSavedMinutes / 60).toFixed(
                        stats.timeSavedMinutes % 60 === 0 ? 0 : 1
                      )}h`
                    : `${stats.timeSavedMinutes}m`
                }
                hint={stats.timeSavedLabel}
                icon={Clock3}
                accent="bg-teal-50 text-teal-700"
              />
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="flex min-h-0 flex-col bg-white shadow-sm ring-slate-200/80 md:col-span-2">
                <CardHeader className="shrink-0">
                  <CardTitle className="text-base text-slate-900">
                    Chat traffic
                  </CardTitle>
                  <CardDescription>
                    Conversations opened in the last 24 hours (by hour)
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col pb-4">
                  {chartData.length === 0 ? (
                    <p className="py-12 text-center text-sm text-slate-500 font-roboto">
                      No conversations yet — traffic will appear here.
                    </p>
                  ) : (
                    <ChartContainer
                      config={trafficChartConfig}
                      className="aspect-auto h-full min-h-[280px] w-full flex-1"
                    >
                      <BarChart
                        accessibilityLayer
                        data={chartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={10}
                          minTickGap={28}
                          tickFormatter={(value) =>
                            formatTrafficTick(String(value), granularity)
                          }
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={36}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) =>
                                formatTrafficLabel(String(value), granularity)
                              }
                            />
                          }
                        />
                        <Bar
                          dataKey="count"
                          fill="var(--color-count)"
                          radius={[2, 2, 0, 0]}
                          maxBarSize={48}
                        />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <RecentChatsPanel className="min-h-[320px] md:col-span-1 md:min-h-0" />
            </div>
          </>
        ) : null}
      </div>
  );
}
