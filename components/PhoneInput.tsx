"use client";

import { cn } from "@/lib/utils";

const DEFAULT_CODE = "+252";

/** Split a stored phone into country code + national number. */
export function splitPhone(full: string): { code: string; national: string } {
  const trimmed = full.trim();
  if (!trimmed) return { code: DEFAULT_CODE, national: "" };

  const match = trimmed.match(/^(\+\d{1,4})\s*(.*)$/);
  if (match) {
    return {
      code: match[1],
      national: match[2].replace(/[^\d\s]/g, "").trimStart(),
    };
  }
  return { code: DEFAULT_CODE, national: trimmed.replace(/[^\d\s]/g, "") };
}

export function joinPhone(code: string, national: string): string {
  const n = national.trim();
  if (!n) return "";
  return `${code} ${n}`.trim();
}

export interface PhoneInputProps {
  id?: string;
  value: string;
  onChange: (full: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** Shown in the number field */
  placeholder?: string;
  /** Fixed country code shown on the left (gray / disabled look) */
  countryCode?: string;
}

/**
 * Two-part phone field: gray country code + national number.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  className,
  autoFocus,
  placeholder = "61",
  countryCode = DEFAULT_CODE,
}: PhoneInputProps) {
  const { national } = splitPhone(
    value.trim().startsWith("+") ? value : joinPhone(countryCode, value)
  );

  function handleNational(raw: string) {
    const cleaned = raw.replace(/[^\d\s]/g, "");
    onChange(joinPhone(countryCode, cleaned));
  }

  return (
    <div
      className={cn(
        "flex h-10 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm",
        className
      )}
    >
      <div
        className="flex shrink-0 items-center border-r border-slate-200 bg-slate-100 px-3 text-sm font-medium text-slate-500 select-none"
        title="Country code"
      >
        {countryCode}
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={national}
        onChange={(e) => handleNational(e.target.value)}
        className="min-w-0 flex-1 bg-white px-3 text-sm font-roboto text-slate-800 outline-none placeholder:text-slate-400"
        aria-label="Phone number"
      />
    </div>
  );
}
