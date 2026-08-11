import {
  DOC_URL_FIELD,
  isEnrollmentDocSlot,
  uploadEnrollmentDocument,
} from "@/lib/storage";
import { upsertEnrollment } from "@/lib/enrollment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonErr(msg: string, status = 400) {
  return Response.json({ error: msg }, { status });
}

/**
 * POST /api/enrollment/upload
 * multipart/form-data: file, slot, conversation_id
 *
 * Uploads to the matching enrollment-* Storage bucket and optionally
 * persists the URL onto the students row for that conversation.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonErr("Expected multipart/form-data");
  }

  const slotRaw = String(form.get("slot") ?? "");
  const conversationId = String(form.get("conversation_id") ?? "").trim();
  const file = form.get("file");

  if (!isEnrollmentDocSlot(slotRaw)) {
    return jsonErr(
      `Invalid slot. Use: photo | id | certificate | payment`
    );
  }
  if (!conversationId) return jsonErr("conversation_id required");
  if (!(file instanceof File)) return jsonErr("file required");

  try {
    const uploaded = await uploadEnrollmentDocument({
      slot: slotRaw,
      conversationId,
      file,
      filename: file.name,
      contentType: file.type,
    });

    // Persist URL as we go so a mid-flow drop isn't lost
    await upsertEnrollment({
      conversation_id: conversationId,
      [DOC_URL_FIELD[slotRaw]]: uploaded.url,
    });

    return Response.json({
      ok: true,
      slot: uploaded.slot,
      bucket: uploaded.bucket,
      path: uploaded.path,
      url: uploaded.url,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upload failed";
    console.error("[/api/enrollment/upload]", msg);
    return jsonErr(msg, 500);
  }
}
