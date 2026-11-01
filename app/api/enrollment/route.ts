import {
  currentStepForEnrollment,
  enrollmentStatusForUpsert,
  isEnrollmentIncomplete,
  isEnrollmentJustSubmitted,
  isEnrollmentSubmitted,
  loadEnrollmentByConversation,
  resetEnrollmentForConversation,
  TOTAL_ENROLLMENT_STEPS,
  upsertEnrollment,
  validateFacultyChoices,
  type EnrollmentData,
} from "@/lib/enrollment";
import {
  enrollmentPausedMessage,
  enrollmentPaymentState,
  enrollmentReceivedConfirmationMessage,
  enrollmentStartOverDoneMessage,
} from "@/lib/enrollment-intent";
import {
  generateEnrollmentConfirmationMessage,
  generateEnrollmentResumeAcknowledgement,
} from "@/lib/enrollment-resume";
import { formatStudentStatus } from "@/lib/status";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonErr(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

async function postAssistantMessage(
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
    console.warn("[/api/enrollment] assistant message:", error.message);
    return null;
  }

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data;
}

/** POST /api/enrollment — upsert partial enrollment data + resume/pause/start-over */
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

    if (action === "resume_prompt") {
      if (!data.conversation_id) return jsonErr("conversation_id required");
      const record = await loadEnrollmentByConversation(data.conversation_id);
      if (!record) {
        return Response.json({ ok: true, skipped: true, reason: "no_enrollment" });
      }

      if (!isEnrollmentIncomplete(record) && isEnrollmentSubmitted(record)) {
        const statusText = formatStudentStatus({
          full_name: record.full_name ?? null,
          enrollment_status: record.enrollment_status ?? null,
          current_step: record.current_step ?? null,
          phone: record.phone || "",
          enrollment_step: record.enrollment_step,
          ...record,
        });
        const message = await postAssistantMessage(
          data.conversation_id,
          statusText
        );
        return Response.json({
          ok: true,
          submitted: true,
          confirmation_message: statusText,
          message,
        });
      }

      if (!isEnrollmentIncomplete(record)) {
        return Response.json({ ok: true, skipped: true, reason: "complete" });
      }

      const ack = await generateEnrollmentResumeAcknowledgement(record);
      const message = await postAssistantMessage(data.conversation_id, ack);
      return Response.json({
        ok: true,
        resume: true,
        confirmation_message: ack,
        message,
        next_step: record.enrollment_step,
      });
    }

    if (action === "pause") {
      if (!data.conversation_id) return jsonErr("conversation_id required");
      const record = await loadEnrollmentByConversation(data.conversation_id);
      if (!record || !isEnrollmentIncomplete(record)) {
        return Response.json({ ok: true, skipped: true });
      }
      // Refresh current_step marker without advancing
      await upsertEnrollment({
        ...record,
        conversation_id: data.conversation_id,
        enrollment_step: record.enrollment_step,
        current_step: currentStepForEnrollment(record),
      });
      const text = enrollmentPausedMessage(record);
      const message = await postAssistantMessage(data.conversation_id, text);
      return Response.json({
        ok: true,
        confirmation_message: text,
        message,
      });
    }

    if (action === "start_over") {
      if (!data.conversation_id) return jsonErr("conversation_id required");
      await resetEnrollmentForConversation(data.conversation_id);
      const text = enrollmentStartOverDoneMessage();
      const message = await postAssistantMessage(data.conversation_id, text);
      return Response.json({
        ok: true,
        confirmation_message: text,
        message,
      });
    }

    const facultyError = validateFacultyChoices(data);
    if (facultyError) return jsonErr(facultyError);

    const justSubmitted = isEnrollmentJustSubmitted(data);
    const status = enrollmentStatusForUpsert(data);
    const step = Number(data.enrollment_step ?? 0);

    const payload: EnrollmentData = {
      ...data,
      enrollment_status: status,
      current_step: currentStepForEnrollment({ ...data, enrollment_status: status }),
      ...(status === "pending_review"
        ? {
            needs_human: true,
            enrollment_step: Math.max(step, TOTAL_ENROLLMENT_STEPS),
          }
        : {}),
    };

    await upsertEnrollment(payload);

    let confirmationMessage: string | null = null;
    let confirmationRow: {
      id: string;
      role: string;
      content: string;
      created_at: string;
    } | null = null;

    if (justSubmitted) {
      confirmationMessage = await generateEnrollmentConfirmationMessage(
        payload
      );
      // Safety net if the model path somehow returns empty
      if (!confirmationMessage?.trim()) {
        confirmationMessage = enrollmentReceivedConfirmationMessage({
          fullName: data.full_name,
          paymentState: enrollmentPaymentState(payload),
        });
      }

      if (data.conversation_id) {
        confirmationRow = await postAssistantMessage(
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
