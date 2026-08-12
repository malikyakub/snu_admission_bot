/**
 * Structured CTA markers embedded in assistant messages.
 * The chat UI strips these and renders clickable arrow links.
 *
 * Formats:
 *   [[cta:enroll]]
 *   [[cta:enroll|Start your application]]
 *   [[cta:handoff|Connect with an admin]]
 */

export type CtaKind = "enroll" | "handoff";

export type CtaToken =
  | { type: "text"; value: string }
  | { type: "cta"; kind: CtaKind; label: string };

const CTA_RE = /\[\[cta:(enroll|handoff)(?:\|([^\]]+))?\]\]/gi;

const DEFAULT_LABELS: Record<CtaKind, string> = {
  enroll: "Start your application",
  handoff: "Connect with an admin",
};

export function ctaMarker(kind: CtaKind, label?: string): string {
  const text = (label || DEFAULT_LABELS[kind]).trim();
  return `[[cta:${kind}|${text}]]`;
}

/** Parse message into prose segments + CTA tokens. */
export function parseCtaContent(content: string): CtaToken[] {
  const out: CtaToken[] = [];
  let last = 0;
  const re = new RegExp(CTA_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      out.push({ type: "text", value: content.slice(last, m.index) });
    }
    const kind = m[1].toLowerCase() as CtaKind;
    const label = (m[2] || DEFAULT_LABELS[kind]).trim();
    out.push({ type: "cta", kind, label });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    out.push({ type: "text", value: content.slice(last) });
  }
  return out.length ? out : [{ type: "text", value: content }];
}

export function hasCta(content: string, kind?: CtaKind): boolean {
  if (!kind) return /\[\[cta:(enroll|handoff)/i.test(content);
  return new RegExp(`\\[\\[cta:${kind}`, "i").test(content);
}

/** Append enroll CTA if not already present. */
export function appendEnrollCta(answer: string, label?: string): string {
  const trimmed = (answer || "").trim();
  if (hasCta(trimmed, "enroll")) return trimmed;
  return `${trimmed}\n\n${ctaMarker("enroll", label)}`;
}

/** Append handoff CTA if not already present. */
export function appendHandoffCta(answer: string, label?: string): string {
  const trimmed = (answer || "").trim();
  if (hasCta(trimmed, "handoff")) return trimmed;
  if (!trimmed) {
    return `I don't have that information.\n\n${ctaMarker("handoff", label)}`;
  }
  return `${trimmed}\n\n${ctaMarker("handoff", label)}`;
}

/** Remove handoff CTA markers (and nothing else). */
export function stripHandoffCta(content: string): string {
  return (content || "")
    .replace(/\[\[cta:handoff(?:\|[^\]]+)?\]\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
