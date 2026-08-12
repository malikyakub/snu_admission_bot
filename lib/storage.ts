import { getSupabase } from "./supabase";

/** Document slots collected in enrollment step 11. */
export type EnrollmentDocSlot =
  | "photo"
  | "id"
  | "certificate"
  | "payment";

/**
 * Create these four buckets in Supabase Storage (private recommended).
 * Dashboard → Storage → New bucket, or SQL in schema.sql.
 */
export const ENROLLMENT_DOC_BUCKETS: Record<EnrollmentDocSlot, string> = {
  photo: "enrollment-photos",
  id: "enrollment-ids",
  certificate: "enrollment-certificates",
  payment: "enrollment-payments",
};

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const ALLOWED_MIME: Record<EnrollmentDocSlot, RegExp> = {
  photo: /^image\/(jpeg|jpg|png|webp|gif)$/i,
  id: /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i,
  certificate: /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i,
  payment: /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf)$/i,
};

export function isEnrollmentDocSlot(v: string): v is EnrollmentDocSlot {
  return v in ENROLLMENT_DOC_BUCKETS;
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function extFromMime(mime: string): string {
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

export type UploadedDoc = {
  slot: EnrollmentDocSlot;
  bucket: string;
  path: string;
  /** Durable URL stored on students.doc_*_url (public or long-lived signed). */
  url: string;
};

/**
 * Upload one enrollment document via the service-role client.
 * Path: `{conversationId}/{timestamp}-{safeName}`
 */
export async function uploadEnrollmentDocument(opts: {
  slot: EnrollmentDocSlot;
  conversationId: string;
  file: File | Blob;
  filename?: string;
  contentType?: string;
}): Promise<UploadedDoc> {
  const { slot, conversationId } = opts;
  const bucket = ENROLLMENT_DOC_BUCKETS[slot];
  const mime =
    opts.contentType ||
    (opts.file instanceof File ? opts.file.type : "") ||
    "application/octet-stream";

  if (!ALLOWED_MIME[slot].test(mime)) {
    throw new Error(
      `Unsupported file type for ${slot}: ${mime}. Use an image${
        slot === "photo" ? "" : " or PDF"
      }.`
    );
  }

  const size =
    typeof (opts.file as File).size === "number"
      ? (opts.file as File).size
      : undefined;
  if (size != null && size > MAX_BYTES) {
    throw new Error(`File too large (max ${MAX_BYTES / (1024 * 1024)} MB)`);
  }
  if (!conversationId?.trim()) {
    throw new Error("conversation_id required for upload path");
  }

  const originalName =
    opts.filename ||
    (opts.file instanceof File ? opts.file.name : `upload.${extFromMime(mime)}`);
  const safe = sanitizeFilename(originalName);
  const path = `${conversationId.trim()}/${Date.now()}-${safe}`;

  const supabase = getSupabase();
  const buffer = Buffer.from(await opts.file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: mime,
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(
      `Storage upload failed (${bucket}): ${uploadError.message}. ` +
        `Confirm bucket "${bucket}" exists.`
    );
  }

  const url = await resolveStoredUrl(bucket, path);
  return { slot, bucket, path, url };
}

/** Prefer public URL; fall back to a 1-year signed URL for private buckets. */
async function resolveStoredUrl(bucket: string, path: string): Promise<string> {
  const supabase = getSupabase();
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  if (pub?.publicUrl) {
    // If bucket is private, public URL won't load — still try a signed URL for durability in DB.
    const { data: signed, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60 * 24 * 365); // 1 year
    if (!error && signed?.signedUrl) return signed.signedUrl;
    return pub.publicUrl;
  }

  const { data: signed, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (error || !signed?.signedUrl) {
    throw new Error(
      `Could not create URL for ${bucket}/${path}: ${error?.message ?? "unknown"}`
    );
  }
  return signed.signedUrl;
}

export const DOC_URL_FIELD: Record<
  EnrollmentDocSlot,
  "doc_photo_url" | "doc_id_url" | "doc_certificate_url" | "doc_payment_url"
> = {
  photo: "doc_photo_url",
  id: "doc_id_url",
  certificate: "doc_certificate_url",
  payment: "doc_payment_url",
};
