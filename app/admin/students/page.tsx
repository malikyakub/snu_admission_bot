"use client";

import { useEffect, useState } from "react";

export default function AdminStudentsStub() {
  const [message, setMessage] = useState("Loading…");

  useEffect(() => {
    setMessage(
      "Admin routes are scaffolded next. This is a placeholder page so /login can redirect successfully for now."
    );
  }, []);

  return (
    <main className="mx-auto max-w-xl p-3 pb-8">
      <h1 className="text-xl font-semibold">Admin - Students</h1>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
    </main>
  );
}

