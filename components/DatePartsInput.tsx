"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MONTHS = [
  { value: 1, label: "January", short: "Jan" },
  { value: 2, label: "February", short: "Feb" },
  { value: 3, label: "March", short: "Mar" },
  { value: 4, label: "April", short: "Apr" },
  { value: 5, label: "May", short: "May" },
  { value: 6, label: "June", short: "Jun" },
  { value: 7, label: "July", short: "Jul" },
  { value: 8, label: "August", short: "Aug" },
  { value: 9, label: "September", short: "Sep" },
  { value: 10, label: "October", short: "Oct" },
  { value: 11, label: "November", short: "Nov" },
  { value: 12, label: "December", short: "Dec" },
] as const;

function daysInMonth(month: number, year: number): number {
  if (!month) return 31;
  const y = year || 2000;
  return new Date(y, month, 0).getDate();
}

function parseIso(iso: string | undefined | null): {
  month: number | null;
  day: number | null;
  year: string;
} {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { month: null, day: null, year: "" };
  }
  const [y, m, d] = iso.split("-").map(Number);
  return { month: m, day: d, year: String(y) };
}

function toIso(
  month: number | null,
  day: number | null,
  year: string
): string | null {
  const y = Number(year);
  if (!month || !day || !y || year.length !== 4) return null;
  const max = daysInMonth(month, y);
  if (day < 1 || day > max) return null;
  const dt = new Date(y, month - 1, day);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface DatePartsInputProps {
  /** ISO `YYYY-MM-DD` when complete */
  value?: string | null;
  onChange?: (iso: string | null) => void;
  className?: string;
  minYear?: number;
  maxYear?: number;
  id?: string;
}

/**
 * Custom date picker: Month | Day | Year in one connected row.
 * Month — type to filter and pick. Day — 1–N for that month. Year — type digits.
 */
export function DatePartsInput({
  value,
  onChange,
  className,
  minYear = 1980,
  maxYear = new Date().getFullYear() - 15,
  id = "dob",
}: DatePartsInputProps) {
  const initial = parseIso(value);
  const [month, setMonth] = useState<number | null>(initial.month);
  const [day, setDay] = useState<number | null>(initial.day);
  const [year, setYear] = useState(initial.year);

  const [monthOpen, setMonthOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [monthQuery, setMonthQuery] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const monthWrapRef = useRef<HTMLDivElement>(null);
  const dayWrapRef = useRef<HTMLDivElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef<string | null>(
    toIso(initial.month, initial.day, initial.year)
  );
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const maxDay = daysInMonth(month ?? 0, Number(year) || 0);

  const filteredMonths = useMemo(() => {
    const q = monthQuery.trim().toLowerCase();
    if (!q) return MONTHS;
    return MONTHS.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.short.toLowerCase().includes(q) ||
        String(m.value) === q
    );
  }, [monthQuery]);

  useEffect(() => {
    if (day != null && day > maxDay) setDay(maxDay);
  }, [maxDay, day]);

  useEffect(() => {
    const iso = toIso(month, day, year);
    if (iso === lastEmitted.current) return;
    lastEmitted.current = iso;
    onChangeRef.current?.(iso);
  }, [month, day, year]);

  // Sync only when parent passes a complete ISO different from what we last emitted
  useEffect(() => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    if (value === lastEmitted.current) return;
    const next = parseIso(value);
    lastEmitted.current = value;
    setMonth(next.month);
    setDay(next.day);
    setYear(next.year);
  }, [value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (monthWrapRef.current && !monthWrapRef.current.contains(t)) {
        setMonthOpen(false);
        setMonthQuery("");
      }
      if (dayWrapRef.current && !dayWrapRef.current.contains(t)) {
        setDayOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const monthDisplay =
    month != null ? MONTHS.find((m) => m.value === month)?.short ?? "" : "";

  function pickMonth(m: number) {
    setMonth(m);
    setMonthOpen(false);
    setMonthQuery("");
    setTimeout(() => {
      const dayBtn = dayWrapRef.current?.querySelector("button");
      (dayBtn as HTMLButtonElement | undefined)?.focus();
    }, 0);
  }

  function pickDay(d: number) {
    setDay(d);
    setDayOpen(false);
    setTimeout(() => yearInputRef.current?.focus(), 0);
  }

  const cell = "relative flex min-w-0 flex-1 flex-col justify-center px-2 py-1.5";
  const labelCls =
    "text-[10px] font-medium uppercase tracking-wide text-slate-400";
  const controlCls =
    "w-full bg-transparent text-center text-sm font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400";

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex w-full overflow-visible rounded-lg border border-slate-200 bg-white divide-x divide-slate-200 shadow-sm",
        className
      )}
    >
      {/* Month — click / type to select */}
      <div ref={monthWrapRef} className={cn(cell, "rounded-l-lg")}>
        <span className={labelCls}>Month</span>
        <input
          ref={monthInputRef}
          id={`${id}-month`}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={monthOpen}
          aria-controls={`${id}-month-list`}
          aria-autocomplete="list"
          placeholder="Month"
          value={monthOpen ? monthQuery : monthDisplay}
          onFocus={() => {
            setMonthOpen(true);
            setDayOpen(false);
            setMonthQuery("");
          }}
          onChange={(e) => {
            setMonthOpen(true);
            setMonthQuery(e.target.value);
            if (month != null) setMonth(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMonthOpen(false);
              setMonthQuery("");
            }
            if (e.key === "Enter" && filteredMonths.length === 1) {
              e.preventDefault();
              pickMonth(filteredMonths[0].value);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMonthOpen(true);
            }
          }}
          className={cn(controlCls, "py-0.5")}
        />
        {monthOpen && (
          <div
            id={`${id}-month-list`}
            className="absolute left-0 top-full z-[120] mt-1 w-[min(100vw-2rem,14rem)] rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
            role="listbox"
          >
            <ul className="max-h-48 overflow-y-auto">
              {filteredMonths.length === 0 ? (
                <li className="px-2 py-2 text-xs text-slate-400">No match</li>
              ) : (
                filteredMonths.map((m) => (
                  <li key={m.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={month === m.value}
                      className={cn(
                        "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-slate-800 hover:bg-sky-50",
                        month === m.value && "bg-sky-100 font-medium"
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMonth(m.value)}
                    >
                      {m.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Day — 1…daysInMonth */}
      <div ref={dayWrapRef} className={cell}>
        <span className={labelCls}>Day</span>
        <button
          type="button"
          id={`${id}-day`}
          disabled={!month}
          aria-haspopup="listbox"
          aria-expanded={dayOpen}
          className={cn(
            controlCls,
            "cursor-pointer py-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          )}
          onClick={() => {
            if (!month) return;
            setDayOpen((o) => !o);
            setMonthOpen(false);
            setMonthQuery("");
          }}
        >
          {day != null ? (
            String(day).padStart(2, "0")
          ) : (
            <span className="font-normal text-slate-400">Day</span>
          )}
        </button>
        {dayOpen && month && (
          <div className="absolute left-1/2 top-full z-[120] mt-1 w-44 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
            <ul
              role="listbox"
              className="grid max-h-48 grid-cols-7 gap-0.5 overflow-y-auto p-1"
              aria-label="Days"
            >
              {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                <li key={d}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={day === d}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md text-xs text-slate-800 hover:bg-sky-50",
                      day === d &&
                        "bg-sky-600 font-medium text-white hover:bg-sky-600"
                    )}
                    onClick={() => pickDay(d)}
                  >
                    {d}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Year — type */}
      <div className={cn(cell, "rounded-r-lg")}>
        <span className={labelCls}>Year</span>
        <input
          ref={yearInputRef}
          id={`${id}-year`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          placeholder="YYYY"
          value={year}
          onChange={(e) =>
            setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          onBlur={() => {
            if (year.length !== 4) return;
            const y = Number(year);
            if (y < minYear || y > maxYear) {
              setYear(String(Math.min(maxYear, Math.max(minYear, y))));
            }
          }}
          onFocus={() => {
            setMonthOpen(false);
            setDayOpen(false);
            setMonthQuery("");
          }}
          className={cn(controlCls, "py-0.5")}
          aria-label={`Year between ${minYear} and ${maxYear}`}
        />
      </div>
    </div>
  );
}
