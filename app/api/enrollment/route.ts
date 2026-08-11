import {
  loadEnrollmentByConversation,
  upsertEnrollment,
  type EnrollmentData,
} from "@/lib/enrollment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonErr(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

/** POST /api/enrollment — upsert partial enrollment data */
export async function POST(req: Request) {
  let body: EnrollmentData & { action?: string };
  try {
    body = await req.json();
  } catch {
    return jsonErr("Invalid JSON");
  }

  const { action, ...data } = body;

  try {
    if (action === "load") {
      if (!data.conversation_id) return jsonErr("conversation_id required");
      const record = await loadEnrollmentByConversation(data.conversation_id);
      return Response.json({ data: record });
    }

    // Default: upsert
    await upsertEnrollment(data);

    // If final step — mark for human review
    if (data.enrollment_step === 13) {
      await upsertEnrollment({
        ...data,
        enrollment_status: "pending_review",
        needs_human: true,
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[/api/enrollment]", msg);
    return jsonErr(msg, 500);
  }
}
