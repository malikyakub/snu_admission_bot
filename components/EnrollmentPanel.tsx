"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Loader2, Paperclip, X } from "lucide-react";
import { DatePartsInput } from "@/components/DatePartsInput";
import { PhoneInput } from "@/components/PhoneInput";
import {
  ALL_FACULTIES,
  allowedFaculties,
  FACULTY_CHOICE_TIER1_NOTE,
  isEnrollmentIncomplete,
  isEnrollmentSubmitted,
  isPaymentChoiceComplete,
  nextIncompleteEnrollmentStep,
  TOTAL_ENROLLMENT_STEPS,
  type EnrollmentData,
  type Faculty,
  type PaymentMethod,
} from "@/lib/enrollment";
import {
  enrollmentPaymentState,
  enrollmentReceivedConfirmationMessage,
} from "@/lib/enrollment-intent";

const TOTAL_STEPS = TOTAL_ENROLLMENT_STEPS;

/* ------------------------------------------------------------------ */
/* Types                                                                 */
/* ------------------------------------------------------------------ */

type StepSubmitFn = (
  fields: Partial<EnrollmentData>,
  _label?: string,
  opts?: { deferComplete?: boolean }
) => Promise<void>;

interface StepProps {
  data: EnrollmentData;
  onSubmit: StepSubmitFn;
  onCancel: () => void;
  onBack?: () => void;
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                   */
/* ------------------------------------------------------------------ */

function isValidPhone(v: string): boolean {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

/* ------------------------------------------------------------------ */
/* Shared step wrapper                                                  */
/* ------------------------------------------------------------------ */

function StepShell({
  step,
  title,
  children,
  onSubmit,
  onBack,
  loading,
  valid,
  submitLabel,
  footerExtra,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  onSubmit: () => void;
  onBack?: () => void;
  loading: boolean;
  valid: boolean;
  submitLabel?: string;
  footerExtra?: React.ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || loading) return;
        onSubmit();
      }}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold shrink-0">
          {step}
        </span>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <div className="ml-auto flex items-center gap-0.5">
          {onBack && step > 1 ? (
            <button
              type="button"
              onClick={onBack}
              disabled={loading}
              className="rounded-md p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
              aria-label="Previous step"
              title="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
          <span className="text-xs text-slate-400">
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {footerExtra}
        <Button
          type="submit"
          className="bg-sky-600 hover:bg-sky-700 text-white px-5"
          disabled={!valid || loading}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-1.5" />
          )}
          {submitLabel ??
            (step === TOTAL_STEPS ? "Submit Application" : "Next")}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Steps 1–11                                                           */
/* ------------------------------------------------------------------ */

function Step1({ data, onSubmit, onBack }: StepProps) {
  const [fullName, setFullName] = useState(data.full_name ?? "");
  const [mothersName, setMothersName] = useState(data.mothers_name ?? "");
  const [loading, setLoading] = useState(false);
  const valid = fullName.trim().length >= 2 && mothersName.trim().length >= 2;

  return (
    <StepShell step={1} title="Your name & mother's name" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      await onSubmit(
        { full_name: fullName.trim(), mothers_name: mothersName.trim() },
        `Full name: ${fullName.trim()}, Mother's name: ${mothersName.trim()}`
      );
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s1-name">Full name</Label>
        <Input id="s1-name" placeholder="e.g. Fadumo Osman Warsame"
          value={fullName} onChange={e => setFullName(e.target.value)}
          autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s1-mom">Mother&apos;s name</Label>
        <Input id="s1-mom" placeholder="e.g. Hodan Ali" value={mothersName}
          onChange={e => setMothersName(e.target.value)} />
      </div>
    </StepShell>
  );
}

function Step2({ data, onSubmit, onBack }: StepProps) {
  const [phone, setPhone] = useState(data.phone ?? "");
  const [loading, setLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const valid = isValidPhone(phone);

  function handlePhone(v: string) {
    setPhone(v);
    if (v && !isValidPhone(v)) setPhoneError("Enter a valid phone number (e.g. 61 234 5678)");
    else setPhoneError("");
  }

  return (
    <StepShell step={2} title="Phone number" onBack={onBack} onSubmit={async () => {
      if (!isValidPhone(phone)) { setPhoneError("Valid phone required"); return; }
      setLoading(true);
      await onSubmit({ phone: phone.trim() }, `Phone: ${phone.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s2-phone">Phone number</Label>
        <PhoneInput
          id="s2-phone"
          value={phone}
          onChange={handlePhone}
          autoFocus
        />
        {phoneError && <p className="text-xs text-red-500">{phoneError}</p>}
        <p className="text-xs text-slate-500">
          Use the number from your application — it&apos;s how we look up your status later.
        </p>
      </div>
    </StepShell>
  );
}

function Step3({ data, onSubmit, onBack }: StepProps) {
  const [gender, setGender] = useState(data.gender ?? "");
  const [dob, setDob] = useState<string | null>(data.date_of_birth ?? null);
  const [placeOfBirth, setPlaceOfBirth] = useState(data.place_of_birth ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!gender && !!dob && placeOfBirth.trim().length >= 2;

  return (
    <StepShell step={3} title="Gender, date of birth & place of birth" onBack={onBack} onSubmit={async () => {
      if (!dob) return;
      setLoading(true);
      await onSubmit({ gender, date_of_birth: dob, place_of_birth: placeOfBirth.trim() },
        `Gender: ${gender}, DOB: ${dob}, Place of birth: ${placeOfBirth.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label>Gender</Label>
        <div className="flex gap-2">
          {["Male", "Female"].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                gender === g
                  ? "border-sky-600 bg-sky-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Date of birth</Label>
        <DatePartsInput value={dob} onChange={setDob} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s3-pob">Place of birth</Label>
        <Input id="s3-pob" placeholder="e.g. Mogadishu" value={placeOfBirth}
          onChange={e => setPlaceOfBirth(e.target.value)} />
      </div>
    </StepShell>
  );
}

function Step4({ data, onSubmit, onBack }: StepProps) {
  const [nationalId, setNationalId] = useState(data.national_id ?? "");
  const [nationality, setNationality] = useState(data.nationality ?? "");
  const [loading, setLoading] = useState(false);
  const valid = nationalId.trim().length >= 3 && nationality.trim().length >= 2;

  return (
    <StepShell step={4} title="National ID / passport & nationality" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      await onSubmit({ national_id: nationalId.trim(), nationality: nationality.trim() },
        `National ID: ${nationalId.trim()}, Nationality: ${nationality.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s4-id">National ID or passport number</Label>
        <Input id="s4-id" placeholder="e.g. A12345678" value={nationalId}
          onChange={e => setNationalId(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s4-nat">Nationality</Label>
        <Input id="s4-nat" placeholder="e.g. Somali" value={nationality}
          onChange={e => setNationality(e.target.value)} />
      </div>
    </StepShell>
  );
}

function Step5({ data, onSubmit, onBack }: StepProps) {
  const [region, setRegion] = useState(data.region ?? "");
  const [address, setAddress] = useState(data.address ?? "");
  const [loading, setLoading] = useState(false);
  const valid = region.trim().length >= 2 && address.trim().length >= 3;

  return (
    <StepShell step={5} title="Current region & address" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      await onSubmit({ region: region.trim(), address: address.trim() },
        `Region: ${region.trim()}, Address: ${address.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s5-reg">Region</Label>
        <Input id="s5-reg" placeholder="e.g. Banaadir" value={region}
          onChange={e => setRegion(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s5-addr">Address</Label>
        <Input id="s5-addr" placeholder="e.g. Hodan District, Mogadishu" value={address}
          onChange={e => setAddress(e.target.value)} />
      </div>
    </StepShell>
  );
}

function Step6({ data, onSubmit, onBack }: StepProps) {
  const [schoolName, setSchoolName] = useState(data.school_name ?? "");
  const [schoolCountry, setSchoolCountry] = useState(data.school_country ?? "");
  const [schoolCity, setSchoolCity] = useState(data.school_region_city ?? "");
  const [loading, setLoading] = useState(false);
  const valid = schoolName.trim().length >= 2 && schoolCountry.trim().length >= 2 && schoolCity.trim().length >= 2;

  return (
    <StepShell step={6} title="Secondary school details" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      await onSubmit({ school_name: schoolName.trim(), school_country: schoolCountry.trim(), school_region_city: schoolCity.trim() },
        `School: ${schoolName.trim()}, Country: ${schoolCountry.trim()}, City: ${schoolCity.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s6-school">School name</Label>
        <Input id="s6-school" placeholder="e.g. Al Safa" value={schoolName}
          onChange={e => setSchoolName(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s6-country">Country</Label>
        <Input id="s6-country" placeholder="e.g. Somalia" value={schoolCountry}
          onChange={e => setSchoolCountry(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s6-city">Region / City</Label>
        <Input id="s6-city" placeholder="e.g. Mogadishu" value={schoolCity}
          onChange={e => setSchoolCity(e.target.value)} />
      </div>
    </StepShell>
  );
}

function Step7({ data, onSubmit, onBack }: StepProps) {
  const [rollNo, setRollNo] = useState(data.exam_roll_number ?? "");
  const [certNo, setCertNo] = useState(data.certificate_number ?? "");
  const [loading, setLoading] = useState(false);
  const valid = rollNo.trim().length >= 2;
  const rollYearPrefix = String(new Date().getFullYear()).slice(-2);

  return (
    <StepShell step={7} title="Exam roll & certificate number" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      const roll = rollNo.trim();
      const cert = certNo.trim();
      await onSubmit(
        {
          exam_roll_number: roll,
          certificate_number: cert || undefined,
        },
        cert
          ? `Exam roll #: ${roll}, Certificate #: ${cert}`
          : `Exam roll #: ${roll}`
      );
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s7-roll">Exam roll number</Label>
        <Input
          id="s7-roll"
          placeholder={`e.g. ${rollYearPrefix}912829`}
          value={rollNo}
          onChange={(e) => setRollNo(e.target.value)}
          autoFocus
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s7-cert">
          Certificate number{" "}
          <span className="font-normal text-slate-400">(optional)</span>
        </Label>
        <Input
          id="s7-cert"
          placeholder="e.g. 123456"
          inputMode="numeric"
          maxLength={6}
          value={certNo}
          onChange={(e) => setCertNo(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </div>
    </StepShell>
  );
}

function Step8({ data, onSubmit, onBack }: StepProps) {
  const [choice, setChoice] = useState(data.faculty_choice_1 ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!choice;

  return (
    <StepShell step={8} title="First faculty choice" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      try {
        await onSubmit({ faculty_choice_1: choice }, `First choice faculty: ${choice}`);
      } finally {
        setLoading(false);
      }
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label>Faculty (1st choice)</Label>
        <Select value={choice} onValueChange={v => setChoice(v ?? "")}>
          <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select your first choice" /></SelectTrigger>
          <SelectContent>
            {ALL_FACULTIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-slate-500">{FACULTY_CHOICE_TIER1_NOTE}</p>
    </StepShell>
  );
}

function Step9({ data, onSubmit, onBack }: StepProps) {
  const firstChoice = data.faculty_choice_1 ?? "";
  const first = firstChoice ? [firstChoice] : [];

  const [choice2, setChoice2] = useState(() => {
    const initial = data.faculty_choice_2 ?? "";
    return allowedFaculties(first, 2).includes(initial as Faculty) ? initial : "";
  });
  const [choice3, setChoice3] = useState(() => {
    const initial = data.faculty_choice_3 ?? "";
    const seed2 = data.faculty_choice_2 ?? "";
    const chosen = [...first, seed2].filter(Boolean) as string[];
    return allowedFaculties(chosen, 3).includes(initial as Faculty) ? initial : "";
  });
  const [loading, setLoading] = useState(false);

  // Choice 2/3: hide all Tier 1 + earlier picks (also hide the other later pick)
  const allowed2 = allowedFaculties(
    [...first, choice3].filter(Boolean) as string[],
    2
  );
  const allowed3 = allowedFaculties(
    [...first, choice2].filter(Boolean) as string[],
    3
  );

  // Clear later choices when an earlier pick makes them invalid
  useEffect(() => {
    if (choice2 && !allowedFaculties(first, 2).includes(choice2 as Faculty)) {
      setChoice2("");
    }
  }, [firstChoice, choice2]); // eslint-disable-line react-hooks/exhaustive-deps -- first derived from firstChoice

  useEffect(() => {
    const allowed = allowedFaculties(
      [...first, choice2].filter(Boolean) as string[],
      3
    );
    if (choice3 && !allowed.includes(choice3 as Faculty)) {
      setChoice3("");
    }
  }, [firstChoice, choice2, choice3]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid =
    !!choice2 &&
    !!choice3 &&
    choice2 !== choice3 &&
    allowed2.includes(choice2 as Faculty) &&
    allowed3.includes(choice3 as Faculty);

  return (
    <StepShell
      onBack={onBack}
      step={9}
      title="2nd & 3rd faculty choices"
      onSubmit={async () => {
        setLoading(true);
        try {
          await onSubmit(
            { faculty_choice_2: choice2, faculty_choice_3: choice3 },
            `2nd choice: ${choice2}, 3rd choice: ${choice3}`
          );
        } finally {
          setLoading(false);
        }
      }}
      loading={loading}
      valid={valid}
    >
      {data.faculty_choice_1 && (
        <p className="text-xs text-slate-500">
          1st choice: <strong>{data.faculty_choice_1}</strong>
        </p>
      )}
      <p className="text-xs text-slate-500">{FACULTY_CHOICE_TIER1_NOTE}</p>
      <div className="grid gap-1.5">
        <Label>Faculty (2nd choice)</Label>
        <Select
          value={choice2}
          onValueChange={(v) => {
            const next = v ?? "";
            setChoice2(next);
            if (choice3 === next) setChoice3("");
          }}
        >
          <SelectTrigger className="h-10 w-full">
            <SelectValue placeholder="Select your second choice" />
          </SelectTrigger>
          <SelectContent>
            {allowed2.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label>Faculty (3rd choice)</Label>
        <Select value={choice3} onValueChange={(v) => setChoice3(v ?? "")}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue placeholder="Select your third choice" />
          </SelectTrigger>
          <SelectContent>
            {allowed3.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </StepShell>
  );
}

function Step10({ data, onSubmit, onBack }: StepProps) {
  const [guardianName, setGuardianName] = useState(data.guardian_name ?? "");
  const [guardianMobile, setGuardianMobile] = useState(data.guardian_mobile ?? "");
  const [guardianRelation, setGuardianRelation] = useState(data.guardian_relation ?? "");
  const [loading, setLoading] = useState(false);
  const valid = guardianName.trim().length >= 2 && isValidPhone(guardianMobile) && guardianRelation.trim().length >= 2;

  return (
    <StepShell step={10} title="Guardian / emergency contact" onBack={onBack} onSubmit={async () => {
      setLoading(true);
      await onSubmit({ guardian_name: guardianName.trim(), guardian_mobile: guardianMobile.trim(), guardian_relation: guardianRelation.trim() },
        `Guardian: ${guardianName.trim()} (${guardianRelation.trim()}), Mobile: ${guardianMobile.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s10-gname">Guardian name</Label>
        <Input id="s10-gname" placeholder="e.g. Osman Warsame" value={guardianName}
          onChange={e => setGuardianName(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s10-gmob">Guardian mobile</Label>
        <PhoneInput
          id="s10-gmob"
          value={guardianMobile}
          onChange={setGuardianMobile}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s10-grel">Relation</Label>
        <Input id="s10-grel" placeholder="e.g. Father, Mother, Uncle" value={guardianRelation}
          onChange={e => setGuardianRelation(e.target.value)} />
      </div>
    </StepShell>
  );
}

type DocUploadSlot = "photo" | "id" | "certificate";
const DOC_UPLOAD_SLOTS: { key: DocUploadSlot; label: string; accept: string }[] = [
  { key: "photo",       label: "Passport photo",    accept: "image/*" },
  { key: "id",          label: "ID document",        accept: "image/*,.pdf" },
  { key: "certificate", label: "School certificate", accept: "image/*,.pdf" },
];

async function uploadEnrollmentFile(
  slot: "photo" | "id" | "certificate" | "payment",
  file: File,
  conversationId: string
) {
  const form = new FormData();
  form.set("file", file);
  form.set("slot", slot);
  form.set("conversation_id", conversationId);
  const res = await fetch("/api/enrollment/upload", {
    method: "POST",
    body: form,
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    url?: string;
    error?: string;
  } | null;
  if (!res.ok || !json?.ok || !json.url) {
    throw new Error(json?.error || `Failed to upload ${slot}`);
  }
  return json.url;
}

function Step11({ data, onSubmit, onBack }: StepProps) {
  const [files, setFiles] = useState<Partial<Record<DocUploadSlot, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<DocUploadSlot, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRefs = useRef<Partial<Record<DocUploadSlot, HTMLInputElement>>>({});
  const valid = DOC_UPLOAD_SLOTS.every((s) => !!files[s.key]);

  function clearSlot(key: DocUploadSlot) {
    setPreviews((p) => {
      const url = p[key];
      if (url) URL.revokeObjectURL(url);
      const next = { ...p };
      delete next[key];
      return next;
    });
    setFiles((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
    setError("");
  }

  function handleFile(key: DocUploadSlot, f: File | null) {
    if (!f) return;
    setError("");
    setPreviews((p) => {
      const prev = p[key];
      if (prev) URL.revokeObjectURL(prev);
      if (f.type.startsWith("image/")) {
        return { ...p, [key]: URL.createObjectURL(f) };
      }
      const next = { ...p };
      delete next[key];
      return next;
    });
    setFiles((prev) => ({ ...prev, [key]: f }));
  }

  useEffect(() => {
    return () => {
      Object.values(previews).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revoke only on unmount
  }, []);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      if (!imageItem) return;
      const f = imageItem.getAsFile();
      if (!f) return;
      const emptySlot = DOC_UPLOAD_SLOTS.find((s) => !files[s.key]);
      if (emptySlot) handleFile(emptySlot.key, f);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [files]);

  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      const conversationId = data.conversation_id?.trim();
      if (!conversationId) {
        throw new Error("Missing conversation — close and reopen enrollment from chat.");
      }

      const urlMap: Partial<Record<DocUploadSlot, string>> = {};
      for (const slot of DOC_UPLOAD_SLOTS) {
        const f = files[slot.key];
        if (!f) throw new Error(`Missing ${slot.label}`);
        urlMap[slot.key] = await uploadEnrollmentFile(slot.key, f, conversationId);
      }

      await onSubmit(
        {
          doc_photo_url: urlMap.photo,
          doc_id_url: urlMap.id,
          doc_certificate_url: urlMap.certificate,
          enrollment_step: 11,
        },
        "Documents uploaded"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StepShell step={11} title="Document uploads" onBack={onBack} onSubmit={handleSubmit} loading={loading} valid={valid}>
      <p className="text-xs text-slate-500">
        Upload your passport photo, ID, and school certificate. Payment comes next.
      </p>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {DOC_UPLOAD_SLOTS.map((slot) => {
          const file = files[slot.key];
          const preview = previews[slot.key];
          const isImage = !!file && file.type.startsWith("image/");

          return (
            <div
              key={slot.key}
              className="relative flex aspect-video w-[calc(50%-0.25rem)] min-w-[7.5rem] flex-col overflow-hidden rounded-lg border border-dashed border-slate-200 bg-slate-50/60 sm:w-[calc(33.333%-0.34rem)]"
            >
              <button
                type="button"
                className="absolute inset-0 z-0"
                onClick={() => fileInputRefs.current[slot.key]?.click()}
                title={`Upload ${slot.label}`}
                aria-label={`Upload ${slot.label}`}
              />

              {isImage && preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt={slot.label}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="relative z-10 flex h-full flex-col items-center justify-center gap-1 px-2 py-2 pointer-events-none">
                  <Paperclip className="h-4 w-4 text-sky-600" />
                  <p className="text-center text-[11px] font-medium leading-tight text-slate-700">
                    {slot.label}
                  </p>
                  {file ? (
                    <p className="w-full truncate text-center text-[10px] text-sky-600">
                      {file.name}
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-400">Tap to upload</p>
                  )}
                </div>
              )}

              {isImage && preview && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4">
                  <p className="truncate text-[10px] font-medium text-white">
                    {slot.label}
                  </p>
                </div>
              )}

              {file && (
                <button
                  type="button"
                  className="absolute right-1 top-1 z-20 rounded-full bg-white/90 p-0.5 shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSlot(slot.key);
                  }}
                >
                  <X className="h-3.5 w-3.5 text-slate-500 hover:text-red-500" />
                </button>
              )}

              <input
                type="file"
                accept={slot.accept}
                className="hidden"
                ref={(el) => {
                  if (el) fileInputRefs.current[slot.key] = el;
                }}
                onChange={(e) =>
                  handleFile(slot.key, e.target.files?.[0] ?? null)
                }
              />
            </div>
          );
        })}
      </div>
    </StepShell>
  );
}

function Step12({ data, onSubmit, onBack, onCancel }: StepProps) {
  const [method, setMethod] = useState<PaymentMethod | "">(
    data.payment_method === "bank_receipt" || data.payment_method === "office_delivery"
      ? data.payment_method
      : ""
  );
  const [receipt, setReceipt] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedLater, setSavedLater] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function clearReceipt() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setReceipt(null);
    setError("");
  }

  function handleReceipt(f: File | null) {
    if (!f) return;
    setError("");
    setMethod("bank_receipt");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setReceipt(f);
  }

  const canSubmit =
    method === "office_delivery" ||
    (method === "bank_receipt" && !!receipt);

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const conversationId = data.conversation_id?.trim();
      if (!conversationId) {
        throw new Error("Missing conversation — close and reopen enrollment from chat.");
      }

      let doc_payment_url = data.doc_payment_url;
      if (method === "bank_receipt") {
        if (!receipt) throw new Error("Add your bank receipt, or save and continue later.");
        doc_payment_url = await uploadEnrollmentFile("payment", receipt, conversationId);
      }

      await onSubmit(
        {
          payment_method: method,
          ...(doc_payment_url ? { doc_payment_url } : {}),
          enrollment_step: 12,
        },
        method === "office_delivery"
          ? "Payment: will deliver receipt to the office."
          : "Payment receipt uploaded."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save payment choice");
    } finally {
      setLoading(false);
    }
  }

  async function handleContinueLater() {
    setLoading(true);
    setError("");
    try {
      await onSubmit(
        {
          payment_method: "bank_receipt",
          enrollment_step: 11,
        },
        "Payment pending — continue later with your bank receipt.",
        { deferComplete: true }
      );
      setSavedLater(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save progress");
    } finally {
      setLoading(false);
    }
  }

  if (savedLater) {
    return (
      <div className="space-y-3 py-2 text-center">
        <p className="text-sm font-semibold text-slate-800">Saved — still in progress</p>
        <p className="text-xs text-slate-500">
          Come back once you have the bank receipt paper. Your application stays in progress until then.
        </p>
        <Button
          type="button"
          className="bg-sky-600 hover:bg-sky-700 text-white"
          onClick={onCancel}
        >
          Back to chat
        </Button>
      </div>
    );
  }

  return (
    <StepShell
      step={12}
      title="Exam fee payment"
      onBack={onBack}
      onSubmit={handleSubmit}
      loading={loading}
      valid={canSubmit}
      submitLabel="Submit Application"
      footerExtra={
        method === "bank_receipt" && !receipt ? (
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void handleContinueLater()}
            className="border-slate-200 text-slate-700"
          >
            Save &amp; continue later
          </Button>
        ) : null
      }
    >
      <p className="text-xs text-slate-500">
        How will you provide the bank payment receipt?
      </p>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => {
            setMethod("bank_receipt");
            setSavedLater(false);
          }}
          className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
            method === "bank_receipt"
              ? "border-sky-400 bg-sky-50 ring-1 ring-sky-200"
              : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <p className="text-sm font-medium text-slate-800">Upload bank receipt</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Optional for now — if you don&apos;t have the paper yet, save and continue later. Your application stays in progress.
          </p>
        </button>

        {method === "bank_receipt" ? (
          <div className="relative ml-1 overflow-hidden rounded-lg border border-dashed border-slate-200 bg-slate-50/60">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-3 text-left"
              onClick={() => fileRef.current?.click()}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Receipt" className="h-12 w-16 rounded object-cover" />
              ) : (
                <Paperclip className="h-4 w-4 shrink-0 text-sky-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-700">
                  {receipt ? receipt.name : "Tap to upload receipt (image or PDF)"}
                </p>
                <p className="text-[10px] text-slate-400">Optional until you have it</p>
              </div>
            </button>
            {receipt ? (
              <button
                type="button"
                className="absolute right-2 top-2 rounded-full bg-white/90 p-0.5 shadow-sm"
                onClick={clearReceipt}
              >
                <X className="h-3.5 w-3.5 text-slate-500" />
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => handleReceipt(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            clearReceipt();
            setMethod("office_delivery");
            setSavedLater(false);
          }}
          className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
            method === "office_delivery"
              ? "border-sky-400 bg-sky-50 ring-1 ring-sky-200"
              : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          <p className="text-sm font-medium text-slate-800">Deliver to the office</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            I confirm I will bring the bank receipt to the SNU office in person.
          </p>
        </button>
      </div>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step map                                                             */
/* ------------------------------------------------------------------ */

const STEPS: React.ComponentType<StepProps>[] = [
  Step1, Step2, Step3, Step4, Step5, Step6, Step7,
  Step8, Step9, Step10, Step11, Step12,
];

/* ------------------------------------------------------------------ */
/* EnrollmentPanel — the drop-up sheet anchored above the chat input   */
/* ------------------------------------------------------------------ */

export interface EnrollmentPanelProps {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  /** Fired when the student finishes the form (bot confirmation text). */
  onComplete?: (payload: {
    confirmation: string;
    message?: {
      id: string;
      role: string;
      content: string;
      created_at: string;
    } | null;
  }) => void;
}

export function EnrollmentPanel({
  open,
  onClose,
  conversationId,
  onComplete,
}: EnrollmentPanelProps) {
  const [enrollData, setEnrollData] = useState<EnrollmentData>({});
  const [currentStep, setCurrentStep] = useState(0); // 0-indexed
  const [done, setDone] = useState(false);

  // Resume: load existing partial data on open (always reset local "done" first)
  useEffect(() => {
    if (!open || !conversationId) return;

    setDone(false);
    setCurrentStep(0);
    setEnrollData({ conversation_id: conversationId });

    fetch("/api/enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", conversation_id: conversationId }),
    })
      .then((r) => r.json())
      .then(({ data: saved }) => {
        if (!saved) return;

        const record = {
          ...(saved as EnrollmentData),
          conversation_id: conversationId,
        };
        setEnrollData(record);

        const incomplete = isEnrollmentIncomplete(record);
        const submitted = !incomplete && isEnrollmentSubmitted(record);

        if (submitted) {
          setDone(true);
          setCurrentStep(TOTAL_STEPS - 1);
          return;
        }

        setDone(false);
        const resumeAt =
          nextIncompleteEnrollmentStep(record) ??
          Number(record.enrollment_step ?? 0) + 1;
        // resumeAt is 1-based step number
        setCurrentStep(
          Math.max(0, Math.min(resumeAt - 1, TOTAL_STEPS - 1))
        );
      })
      .catch(() => {
        // Start from scratch — local reset already applied
      });
  }, [open, conversationId]);

  const handleStepSubmit: StepSubmitFn = useCallback(
    async (fields, _label, opts) => {
      // Accept either (fields) or legacy (fields, label) — never post to chat
      const deferComplete = opts?.deferComplete === true;
      const nextStep =
        typeof fields.enrollment_step === "number"
          ? fields.enrollment_step
          : currentStep + 1;
      const merged: EnrollmentData = {
        ...enrollData,
        ...fields,
        conversation_id: conversationId ?? undefined,
        enrollment_step: nextStep,
      };
      setEnrollData(merged);

      // Persist to backend only — do not mirror answers into the chat transcript
      let confirmation: string | null = null;
      let confirmationRow: {
        id: string;
        role: string;
        content: string;
        created_at: string;
      } | null = null;
      try {
        const res = await fetch("/api/enrollment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(merged),
        });
        const json = (await res.json().catch(() => null)) as {
          error?: string;
          confirmation_message?: string;
          message?: {
            id: string;
            role: string;
            content: string;
            created_at: string;
          } | null;
        } | null;
        if (!res.ok) {
          throw new Error(json?.error || "Could not save enrollment step");
        }
        confirmation = json?.confirmation_message?.trim() || null;
        confirmationRow = json?.message ?? null;
      } catch (err) {
        // Roll back optimistic merge on hard failures (e.g. invalid faculty)
        setEnrollData(enrollData);
        throw err;
      }

      const finished =
        !deferComplete &&
        nextStep >= STEPS.length &&
        isPaymentChoiceComplete(merged);

      if (finished) {
        setDone(true);
        const text =
          confirmation ||
          enrollmentReceivedConfirmationMessage({
            fullName: merged.full_name,
            paymentState: enrollmentPaymentState(merged),
          });
        onComplete?.({
          confirmation: text,
          message: confirmationRow,
        });
      } else if (!deferComplete && nextStep < STEPS.length) {
        setCurrentStep(nextStep);
      } else if (deferComplete) {
        // Stay on payment step (or reopen there later via enrollment_step)
        setCurrentStep(Math.min(nextStep, STEPS.length - 1));
      }
    },
    [currentStep, enrollData, conversationId, onComplete]
  );

  if (!open) return null;

  const StepComponent = STEPS[currentStep];

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50 px-2">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-sky-50 border-b border-sky-100">
          <div>
            <p className="text-sm font-semibold text-sky-800">SNU Application</p>
            <p className="text-xs text-sky-600">Answer carefully with accurate information — progress saves automatically</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step progress bar */}
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-sky-500 transition-all duration-300"
            style={{ width: `${((currentStep) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {done ? (
            <div className="text-center py-6">
              <p className="font-semibold text-slate-800">Application received</p>
              <p className="text-sm text-slate-500 mt-1">
                Status: <strong>Under review</strong>
                {enrollData.payment_method === "office_delivery" ||
                (enrollData.payment_method === "bank_receipt" &&
                  !enrollData.doc_payment_url)
                  ? (
                    <>
                      . Payment: <strong>pending</strong>
                      {enrollData.payment_method === "office_delivery"
                        ? " (bring your receipt to the office)"
                        : ""}
                    </>
                  ) : null}
                . Check the chat for how to track your application.
              </p>
              <Button
                className="mt-4 bg-sky-600 hover:bg-sky-700 text-white"
                onClick={() => {
                  // Finished — close without a "paused" reminder
                  onClose();
                }}
              >
                Back to chat
              </Button>
            </div>
          ) : (
            <StepComponent
              data={enrollData}
              onSubmit={handleStepSubmit}
              onCancel={onClose}
              onBack={() =>
                setCurrentStep((s) => Math.max(0, s - 1))
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
