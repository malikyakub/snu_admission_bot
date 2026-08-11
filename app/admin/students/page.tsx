"use client";

import Link from "next/link";

export default function AdminStudentsPage() {
  return (
    <div className="shrink-0">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Students
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        Student management UI comes next. Use the{" "}
        <Link href="/admin/dashboard" className="text-sky-700 hover:underline">
          dashboard
        </Link>{" "}
        for live totals.
      </p>
    </div>
  );
}
