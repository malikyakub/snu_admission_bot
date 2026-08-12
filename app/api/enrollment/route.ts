import {
  loadEnrollmentByConversation,
  upsertEnrollment,
  type EnrollmentData,
} from "@/lib/enrollment";
import { enrollmentReceivedConfirmationMessage } from "@/lib/enrollment-intent";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Final student-facing enrollment step (document uploads). */
const FINAL_ENROLLMENT_STEP = 11;

function jsonErr(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

async function postAssistantConfirmation(
  conversationId: string,
  content: string
): Promise<{ id: string; role: string; content: string; created_at: string } | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
    })
    .select("id, role, content, created_at")
    .single();

  if (error) {
    console.warn("[/api/enrollment] confirmation message:", error.message);
    return null;
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data;
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

    const step = Number(data.enrollment_step ?? 0);
    const isFinal = step >= FINAL_ENROLLMENT_STEP;

    let confirmationMessage: string | null = null;
    let confirmationRow: {
      id: string;
      role: string;
      content: string;
      created_at: string;
    } | null = null;

    // Final step — mark for review and send bot receipt in the chat
    if (isFinal) {
      await upsertEnrollment({
        ...data,
        enrollment_status: "pending_review",
        needs_human: true,
      });

      confirmationMessage = enrollmentReceivedConfirmationMessage({
        fullName: data.full_name,
        phone: data.phone,
      });

      if (data.conversation_id) {
        confirmationRow = await postAssistantConfirmation(
          data.conversation_id,
          confirmationMessage
        );
      }
    }

    return Response.json({
      ok: true,
      confirmation_message: confirmationMessage,
      message: confirmationRow,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    console.error("[/api/enrollment]", msg);
    return jsonErr(msg, 500);
  }
}
