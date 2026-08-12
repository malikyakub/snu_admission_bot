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
import { ChevronRight, Loader2, Paperclip, X } from "lucide-react";
import { DatePartsInput } from "@/components/DatePartsInput";
import { PhoneInput } from "@/components/PhoneInput";
import {
  ALL_FACULTIES,
  allowedFaculties,
  type EnrollmentData,
} from "@/lib/enrollment";
import { enrollmentReceivedConfirmationMessage } from "@/lib/enrollment-intent";

const TOTAL_STEPS = 11;

/* ------------------------------------------------------------------ */
/* Types                                                                 */
/* ------------------------------------------------------------------ */

type StepSubmitFn = (
  fields: Partial<EnrollmentData>,
  _label?: string
) => Promise<void>;

interface StepProps {
  data: EnrollmentData;
  onSubmit: StepSubmitFn;
  onCancel: () => void;
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
  loading,
  valid,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  onSubmit: () => void;
  loading: boolean;
  valid: boolean;
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
        <span className="ml-auto text-xs text-slate-400">Step {step} of {TOTAL_STEPS}</span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
      <div className="flex justify-end pt-1">
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
          {step === TOTAL_STEPS ? "Submit Application" : "Next"}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Steps 1–13                                                           */
/* ------------------------------------------------------------------ */

function Step1({ data, onSubmit }: StepProps) {
  const [fullName, setFullName] = useState(data.full_name ?? "");
  const [mothersName, setMothersName] = useState(data.mothers_name ?? "");
  const [loading, setLoading] = useState(false);
  const valid = fullName.trim().length >= 2 && mothersName.trim().length >= 2;

  return (
    <StepShell step={1} title="Your name & mother's name" onSubmit={async () => {
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

function Step2({ data, onSubmit }: StepProps) {
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
    <StepShell step={2} title="Phone number" onSubmit={async () => {
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

function Step3({ data, onSubmit }: StepProps) {
  const [gender, setGender] = useState(data.gender ?? "");
  const [dob, setDob] = useState<string | null>(data.date_of_birth ?? null);
  const [placeOfBirth, setPlaceOfBirth] = useState(data.place_of_birth ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!gender && !!dob && placeOfBirth.trim().length >= 2;

  return (
    <StepShell step={3} title="Gender, date of birth & place of birth" onSubmit={async () => {
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

function Step4({ data, onSubmit }: StepProps) {
  const [nationalId, setNationalId] = useState(data.national_id ?? "");
  const [nationality, setNationality] = useState(data.nationality ?? "");
  const [loading, setLoading] = useState(false);
  const valid = nationalId.trim().length >= 3 && nationality.trim().length >= 2;

  return (
    <StepShell step={4} title="National ID / passport & nationality" onSubmit={async () => {
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

function Step5({ data, onSubmit }: StepProps) {
  const [region, setRegion] = useState(data.region ?? "");
  const [address, setAddress] = useState(data.address ?? "");
  const [loading, setLoading] = useState(false);
  const valid = region.trim().length >= 2 && address.trim().length >= 3;

  return (
    <StepShell step={5} title="Current region & address" onSubmit={async () => {
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

function Step6({ data, onSubmit }: StepProps) {
  const [schoolName, setSchoolName] = useState(data.school_name ?? "");
  const [schoolCountry, setSchoolCountry] = useState(data.school_country ?? "");
  const [schoolCity, setSchoolCity] = useState(data.school_region_city ?? "");
  const [loading, setLoading] = useState(false);
  const valid = schoolName.trim().length >= 2 && schoolCountry.trim().length >= 2 && schoolCity.trim().length >= 2;

  return (
    <StepShell step={6} title="Secondary school details" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ school_name: schoolName.trim(), school_country: schoolCountry.trim(), school_region_city: schoolCity.trim() },
        `School: ${schoolName.trim()}, Country: ${schoolCountry.trim()}, City: ${schoolCity.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s6-school">School name</Label>
        <Input id="s6-school" placeholder="e.g. SOS Hermann Gmeiner School" value={schoolName}
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

function Step7({ data, onSubmit }: StepProps) {
  const [rollNo, setRollNo] = useState(data.exam_roll_number ?? "");
  const [certNo, setCertNo] = useState(data.certificate_number ?? "");
  const [loading, setLoading] = useState(false);
  const valid = rollNo.trim().length >= 2;
  const rollYearPrefix = String(new Date().getFullYear()).slice(-2);

  return (
    <StepShell step={7} title="Exam roll & certificate number" onSubmit={async () => {
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

function Step8({ data, onSubmit }: StepProps) {
  const [choice, setChoice] = useState(data.faculty_choice_1 ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!choice;

  return (
    <StepShell step={8} title="First faculty choice" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ faculty_choice_1: choice }, `First choice faculty: ${choice}`);
      setLoading(false);
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
      <p className="text-xs text-slate-500">
        Note: Medicine & Surgery, Science, Engineering, and Economic & Management Science are Tier 1 — you may only pick one Tier 1 faculty across all three choices.
      </p>
    </StepShell>
  );
}

function Step9({ data, onSubmit }: StepProps) {
  const [choice2, setChoice2] = useState(data.faculty_choice_2 ?? "");
  const [choice3, setChoice3] = useState(data.faculty_choice_3 ?? "");
  const [loading, setLoading] = useState(false);
  const first = data.faculty_choice_1 ? [data.faculty_choice_1] : [];
  const allowed2 = allowedFaculties(first, first);
  const chosenFor3 = [...first, choice2].filter(Boolean) as string[];
  const allowed3 = allowedFaculties(chosenFor3, chosenFor3);
  const valid =
    !!choice2 &&
    !!choice3 &&
    choice2 !== choice3;

  return (
    <StepShell
      step={9}
      title="2nd & 3rd faculty choices"
      onSubmit={async () => {
        setLoading(true);
        await onSubmit(
          { faculty_choice_2: choice2, faculty_choice_3: choice3 },
          `2nd choice: ${choice2}, 3rd choice: ${choice3}`
        );
        setLoading(false);
      }}
      loading={loading}
      valid={valid}
    >
      {data.faculty_choice_1 && (
        <p className="text-xs text-slate-500">
          1st choice: <strong>{data.faculty_choice_1}</strong>
        </p>
      )}
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

function Step10({ data, onSubmit }: StepProps) {
  const [guardianName, setGuardianName] = useState(data.guardian_name ?? "");
  const [guardianMobile, setGuardianMobile] = useState(data.guardian_mobile ?? "");
  const [guardianRelation, setGuardianRelation] = useState(data.guardian_relation ?? "");
  const [loading, setLoading] = useState(false);
  const valid = guardianName.trim().length >= 2 && isValidPhone(guardianMobile) && guardianRelation.trim().length >= 2;

  return (
    <StepShell step={10} title="Guardian / emergency contact" onSubmit={async () => {
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

type UploadSlot = "photo" | "id" | "certificate" | "payment";
const UPLOAD_SLOTS: { key: UploadSlot; label: string; accept: string }[] = [
  { key: "photo",       label: "Passport photo",    accept: "image/*" },
  { key: "id",          label: "ID document",        accept: "image/*,.pdf" },
  { key: "certificate", label: "School certificate", accept: "image/*,.pdf" },
  { key: "payment",     label: "Payment receipt",    accept: "image/*,.pdf" },
];

function Step11({ data, onSubmit }: StepProps) {
  const [files, setFiles] = useState<Partial<Record<UploadSlot, File>>>({});
  const [previews, setPreviews] = useState<Partial<Record<UploadSlot, string>>>({});
  const [loading, setLoading] = useState(false);
  const fileInputRefs = useRef<Partial<Record<UploadSlot, HTMLInputElement>>>({});
  const valid = UPLOAD_SLOTS.every((s) => !!files[s.key]);

  function clearSlot(key: UploadSlot) {
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
  }

  function handleFile(key: UploadSlot, f: File | null) {
    if (!f) return;
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

  // Paste support
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      if (!imageItem) return;
      const f = imageItem.getAsFile();
      if (!f) return;
      const emptySlot = UPLOAD_SLOTS.find((s) => !files[s.key]);
      if (emptySlot) handleFile(emptySlot.key, f);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [files]);

  async function handleSubmit() {
    setLoading(true);
    const urlMap: Partial<Record<UploadSlot, string>> = {};
    for (const slot of UPLOAD_SLOTS) {
      const f = files[slot.key];
      if (f) urlMap[slot.key] = URL.createObjectURL(f);
    }
    await onSubmit(
      {
        doc_photo_url: urlMap.photo,
        doc_id_url: urlMap.id,
        doc_certificate_url: urlMap.certificate,
        doc_payment_url: urlMap.payment,
        enrollment_step: 11,
      },
      "Documents uploaded — application submitted for review."
    );
    setLoading(false);
  }

  return (
    <StepShell step={11} title="Document uploads" onSubmit={handleSubmit} loading={loading} valid={valid}>
      <p className="text-xs text-slate-500">
        Tap a card to upload, or paste an image (Ctrl+V / ⌘+V).
      </p>
      <div className="flex flex-wrap gap-2">
        {UPLOAD_SLOTS.map((slot) => {
          const file = files[slot.key];
          const preview = previews[slot.key];
          const isImage = !!file && file.type.startsWith("image/");

          return (
            <div
              key={slot.key}
              className="relative flex aspect-video w-[calc(50%-0.25rem)] min-w-[7.5rem] flex-col overflow-hidden rounded-lg border border-dashed border-slate-200 bg-slate-50/60 sm:w-[calc(25%-0.375rem)]"
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

/* ------------------------------------------------------------------ */
/* Step map                                                             */
/* ------------------------------------------------------------------ */

const STEPS: React.ComponentType<StepProps>[] = [
  Step1, Step2, Step3, Step4, Step5, Step6, Step7,
  Step8, Step9, Step10, Step11,
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

  // Resume: load existing partial data on open
  useEffect(() => {
    if (!open || !conversationId) return;
    setEnrollData((prev) => ({ ...prev, conversation_id: conversationId }));
    fetch("/api/enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", conversation_id: conversationId }),
    })
      .then(r => r.json())
      .then(({ data: saved }) => {
        if (saved) {
          setEnrollData({
            ...(saved as EnrollmentData),
            conversation_id: conversationId,
          });
          // Resume from saved step
          const savedStep = (saved.enrollment_step ?? 1) - 1;
          setCurrentStep(Math.max(0, Math.min(savedStep, STEPS.length - 1)));
        }
      })
      .catch(() => {}); // silently ignore — start from scratch
  }, [open, conversationId]);

  const handleStepSubmit: StepSubmitFn = useCallback(
    async (fields) => {
      // Accept either (fields) or legacy (fields, label) — never post to chat
      const nextStep = currentStep + 1;
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
          confirmation_message?: string;
          message?: {
            id: string;
            role: string;
            content: string;
            created_at: string;
          } | null;
        } | null;
        confirmation = json?.confirmation_message?.trim() || null;
        confirmationRow = json?.message ?? null;
      } catch {
        // Non-fatal — local state is still updated
      }

      if (nextStep >= STEPS.length) {
        setDone(true);
        const text =
          confirmation ||
          enrollmentReceivedConfirmationMessage({
            fullName: merged.full_name,
            phone: merged.phone,
          });
        onComplete?.({
          confirmation: text,
          message: confirmationRow,
        });
      } else {
        setCurrentStep(nextStep);
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
                Status: <strong>Under review</strong>. Check the chat for how to track your application.
              </p>
              <Button className="mt-4 bg-sky-600 hover:bg-sky-700 text-white" onClick={onClose}>
                Back to chat
              </Button>
            </div>
          ) : (
            <StepComponent
              data={enrollData}
              onSubmit={handleStepSubmit}
              onCancel={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
