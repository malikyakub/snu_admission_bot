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
import {
  ALL_FACULTIES,
  allowedFaculties,
  EXAM_LOCATIONS,
  STUDY_CAMPUSES,
  type EnrollmentData,
} from "@/lib/enrollment";

const TOTAL_STEPS = 13;

const MONTHS = [
  { value: "1", label: "Jan" },
  { value: "2", label: "Feb" },
  { value: "3", label: "Mar" },
  { value: "4", label: "Apr" },
  { value: "5", label: "May" },
  { value: "6", label: "Jun" },
  { value: "7", label: "Jul" },
  { value: "8", label: "Aug" },
  { value: "9", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
] as const;

const DOB_MAX_YEAR = new Date().getFullYear() - 15;
const DOB_MIN_YEAR = 1980;
const DOB_YEARS = Array.from(
  { length: DOB_MAX_YEAR - DOB_MIN_YEAR + 1 },
  (_, i) => String(DOB_MAX_YEAR - i)
);

/* ------------------------------------------------------------------ */
/* Types                                                                 */
/* ------------------------------------------------------------------ */

type StepSubmitFn = (
  fields: Partial<EnrollmentData>,
  label: string
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

function parseDobParts(iso: string): { day: string; month: string; year: string } {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { day: "", month: "", year: "" };
  }
  const [year, month, day] = iso.split("-");
  return {
    day: String(Number(day)),
    month: String(Number(month)),
    year,
  };
}

function buildDob(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!d || !m || !y || y < DOB_MIN_YEAR || y > DOB_MAX_YEAR) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
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
    <div className="flex flex-col gap-4">
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
          className="bg-sky-600 hover:bg-sky-700 text-white px-5"
          disabled={!valid || loading}
          onClick={onSubmit}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-1.5" />
          )}
          {step === TOTAL_STEPS ? "Submit Application" : "Next"}
        </Button>
      </div>
    </div>
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
    if (v && !isValidPhone(v)) setPhoneError("Enter a valid phone number (e.g. +252 61 234 5678)");
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
        <Input id="s2-phone" placeholder="+252 61 234 5678" value={phone}
          onChange={e => handlePhone(e.target.value)} inputMode="tel" autoFocus />
        {phoneError && <p className="text-xs text-red-500">{phoneError}</p>}
        <p className="text-xs text-slate-500">
          Use the number from your application — it&apos;s how we look up your status later.
        </p>
      </div>
    </StepShell>
  );
}

function Step3({ data, onSubmit }: StepProps) {
  const initial = parseDobParts(data.date_of_birth ?? "");
  const [gender, setGender] = useState(data.gender ?? "");
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const [placeOfBirth, setPlaceOfBirth] = useState(data.place_of_birth ?? "");
  const [loading, setLoading] = useState(false);
  const dob = buildDob(day, month, year);
  const valid = !!gender && !!dob && placeOfBirth.trim().length >= 2;

  const fieldClass =
    "h-10 flex-1 min-w-0 border-0 bg-transparent px-2 text-center text-sm text-slate-800 outline-none focus:bg-sky-50/60 disabled:opacity-50";

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
        <div className="flex w-full overflow-hidden rounded-lg border border-slate-200 bg-white divide-x divide-slate-200">
          <select
            aria-label="Day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className={fieldClass}
          >
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
              <option key={d} value={d}>{d.padStart(2, "0")}</option>
            ))}
          </select>
          <select
            aria-label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={fieldClass}
          >
            <option value="">Month</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className={`${fieldClass} flex-[1.2]`}
          >
            <option value="">Year</option>
            {DOB_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
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
  const [certType, setCertType] = useState(data.certificate_type ?? "");
  const [rollNo, setRollNo] = useState(data.exam_roll_number ?? "");
  const [certNo, setCertNo] = useState(data.certificate_number ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!certType && rollNo.trim().length >= 2 && certNo.trim().length >= 2;

  const certTypes = [
    "Somali Secondary School Certificate (SSSC)",
    "National Exam Certificate",
    "O-Level / IGCSE",
    "Other Recognized Certificate",
  ];

  return (
    <StepShell step={7} title="Certificate & exam numbers" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ certificate_type: certType, exam_roll_number: rollNo.trim(), certificate_number: certNo.trim() },
        `Certificate: ${certType}, Roll #: ${rollNo.trim()}, Cert #: ${certNo.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label>Certificate type</Label>
        <Select value={certType} onValueChange={v => setCertType(v ?? "")}>
          <SelectTrigger className="h-10 w-full">
            <SelectValue placeholder="Select certificate type" />
          </SelectTrigger>
          <SelectContent>
            {certTypes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s7-roll">Secondary exam roll number</Label>
        <Input id="s7-roll" placeholder="e.g. 2024/001234" value={rollNo}
          onChange={e => setRollNo(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s7-cert">Secondary certificate number</Label>
        <Input id="s7-cert" placeholder="e.g. SSSC-2024-5678" value={certNo}
          onChange={e => setCertNo(e.target.value)} />
      </div>
    </StepShell>
  );
}

function Step8({ data, onSubmit }: StepProps) {
  const [campus, setCampus] = useState(data.study_campus ?? "");
  const [examLoc, setExamLoc] = useState(data.exam_location ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!campus && !!examLoc;

  return (
    <StepShell step={8} title="Preferred campus & exam location" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ study_campus: campus, exam_location: examLoc },
        `Campus: ${campus}, Exam location: ${examLoc}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label>Study campus</Label>
        <Select value={campus} onValueChange={v => setCampus(v ?? "")}>
          <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select campus" /></SelectTrigger>
          <SelectContent>
            {STUDY_CAMPUSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label>Exam location</Label>
        <Select value={examLoc} onValueChange={v => setExamLoc(v ?? "")}>
          <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select exam location" /></SelectTrigger>
          <SelectContent>
            {EXAM_LOCATIONS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </StepShell>
  );
}

function Step9({ data, onSubmit }: StepProps) {
  const [choice, setChoice] = useState(data.faculty_choice_1 ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!choice;

  return (
    <StepShell step={9} title="First faculty choice" onSubmit={async () => {
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

function Step10({ data, onSubmit }: StepProps) {
  const [choice, setChoice] = useState(data.faculty_choice_2 ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!choice;
  const choices1 = data.faculty_choice_1 ? [data.faculty_choice_1] : [];
  const allowed = allowedFaculties(choices1, choices1);

  return (
    <StepShell step={10} title="Second faculty choice" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ faculty_choice_2: choice }, `Second choice faculty: ${choice}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label>Faculty (2nd choice)</Label>
        <Select value={choice} onValueChange={v => setChoice(v ?? "")}>
          <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select your second choice" /></SelectTrigger>
          <SelectContent>
            {allowed.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {data.faculty_choice_1 && (
        <p className="text-xs text-slate-500">1st choice: <strong>{data.faculty_choice_1}</strong></p>
      )}
    </StepShell>
  );
}

function Step11({ data, onSubmit }: StepProps) {
  const [choice, setChoice] = useState(data.faculty_choice_3 ?? "");
  const [loading, setLoading] = useState(false);
  const valid = !!choice;
  const chosen = [data.faculty_choice_1, data.faculty_choice_2].filter(Boolean) as string[];
  const allowed = allowedFaculties(chosen, chosen);

  return (
    <StepShell step={11} title="Third faculty choice" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ faculty_choice_3: choice }, `Third choice faculty: ${choice}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label>Faculty (3rd choice)</Label>
        <Select value={choice} onValueChange={v => setChoice(v ?? "")}>
          <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select your third choice" /></SelectTrigger>
          <SelectContent>
            {allowed.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {chosen.length > 0 && (
        <p className="text-xs text-slate-500">
          Chosen so far: {chosen.map((c, i) => <strong key={i}>{c}{i < chosen.length - 1 ? ", " : ""}</strong>)}
        </p>
      )}
    </StepShell>
  );
}

function Step12({ data, onSubmit }: StepProps) {
  const [guardianName, setGuardianName] = useState(data.guardian_name ?? "");
  const [guardianMobile, setGuardianMobile] = useState(data.guardian_mobile ?? "");
  const [guardianRelation, setGuardianRelation] = useState(data.guardian_relation ?? "");
  const [loading, setLoading] = useState(false);
  const valid = guardianName.trim().length >= 2 && isValidPhone(guardianMobile) && guardianRelation.trim().length >= 2;

  return (
    <StepShell step={12} title="Guardian / emergency contact" onSubmit={async () => {
      setLoading(true);
      await onSubmit({ guardian_name: guardianName.trim(), guardian_mobile: guardianMobile.trim(), guardian_relation: guardianRelation.trim() },
        `Guardian: ${guardianName.trim()} (${guardianRelation.trim()}), Mobile: ${guardianMobile.trim()}`);
      setLoading(false);
    }} loading={loading} valid={valid}>
      <div className="grid gap-1.5">
        <Label htmlFor="s12-gname">Guardian name</Label>
        <Input id="s12-gname" placeholder="e.g. Osman Warsame" value={guardianName}
          onChange={e => setGuardianName(e.target.value)} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s12-gmob">Guardian mobile</Label>
        <Input id="s12-gmob" placeholder="+252 61 234 5678" value={guardianMobile}
          onChange={e => setGuardianMobile(e.target.value)} inputMode="tel" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="s12-grel">Relation</Label>
        <Input id="s12-grel" placeholder="e.g. Father, Mother, Uncle" value={guardianRelation}
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

function Step13({ data, onSubmit }: StepProps) {
  const [files, setFiles] = useState<Partial<Record<UploadSlot, File>>>({});
  const [loading, setLoading] = useState(false);
  const fileInputRefs = useRef<Partial<Record<UploadSlot, HTMLInputElement>>>({});
  const valid = UPLOAD_SLOTS.every(s => !!files[s.key]);

  function handleFile(key: UploadSlot, f: File | null) {
    if (!f) return;
    setFiles(prev => ({ ...prev, [key]: f }));
  }

  // Paste support
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find(i => i.type.startsWith("image/"));
      if (!imageItem) return;
      const f = imageItem.getAsFile();
      if (!f) return;
      // Paste goes into the first empty slot
      const emptySlot = UPLOAD_SLOTS.find(s => !files[s.key]);
      if (emptySlot) handleFile(emptySlot.key, f);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [files]);

  async function handleSubmit() {
    setLoading(true);
    // In production: upload files to Supabase Storage and get URLs.
    // For now we use object URLs as placeholders (admin will verify uploads).
    const urlMap: Partial<Record<UploadSlot, string>> = {};
    for (const slot of UPLOAD_SLOTS) {
      const f = files[slot.key];
      if (f) urlMap[slot.key] = URL.createObjectURL(f);
    }
    await onSubmit(
      {
        doc_photo_url:       urlMap.photo,
        doc_id_url:          urlMap.id,
        doc_certificate_url: urlMap.certificate,
        doc_payment_url:     urlMap.payment,
        enrollment_step:     13,
      },
      "Documents uploaded — application submitted for review."
    );
    setLoading(false);
  }

  return (
    <StepShell step={13} title="Document uploads" onSubmit={handleSubmit} loading={loading} valid={valid}>
      <p className="text-xs text-slate-500">
        Tap the <strong>+</strong> button for each document, or paste an image directly (Ctrl+V / ⌘+V).
      </p>
      <div className="flex flex-col gap-2">
        {UPLOAD_SLOTS.map(slot => (
          <div key={slot.key} className="flex items-center gap-3 rounded-lg border border-dashed border-slate-200 p-2">
            <button
              type="button"
              className="flex items-center justify-center w-8 h-8 rounded-full bg-sky-50 hover:bg-sky-100 text-sky-600 shrink-0 transition-colors"
              onClick={() => fileInputRefs.current[slot.key]?.click()}
              title={`Upload ${slot.label}`}
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700">{slot.label}</p>
              {files[slot.key] ? (
                <p className="text-xs text-sky-600 truncate">{files[slot.key]!.name}</p>
              ) : (
                <p className="text-xs text-slate-400">Not uploaded</p>
              )}
            </div>
            {files[slot.key] && (
              <button type="button" onClick={() => setFiles(p => { const n = {...p}; delete n[slot.key]; return n; })}>
                <X className="w-4 h-4 text-slate-400 hover:text-red-400" />
              </button>
            )}
            <input
              type="file"
              accept={slot.accept}
              className="hidden"
              ref={el => { if (el) fileInputRefs.current[slot.key] = el; }}
              onChange={e => handleFile(slot.key, e.target.files?.[0] ?? null)}
            />
          </div>
        ))}
      </div>
    </StepShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step map                                                             */
/* ------------------------------------------------------------------ */

const STEPS: React.ComponentType<StepProps>[] = [
  Step1, Step2, Step3, Step4, Step5, Step6, Step7,
  Step8, Step9, Step10, Step11, Step12, Step13,
];

/* ------------------------------------------------------------------ */
/* EnrollmentPanel — the drop-up sheet anchored above the chat input   */
/* ------------------------------------------------------------------ */

export interface EnrollmentPanelProps {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  /** Called with the human-readable summary of each step to post in chat */
  onStepMessage: (msg: string) => void;
}

export function EnrollmentPanel({
  open,
  onClose,
  conversationId,
  onStepMessage,
}: EnrollmentPanelProps) {
  const [enrollData, setEnrollData] = useState<EnrollmentData>({});
  const [currentStep, setCurrentStep] = useState(0); // 0-indexed
  const [done, setDone] = useState(false);

  // Resume: load existing partial data on open
  useEffect(() => {
    if (!open || !conversationId) return;
    fetch("/api/enrollment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "load", conversation_id: conversationId }),
    })
      .then(r => r.json())
      .then(({ data: saved }) => {
        if (saved) {
          setEnrollData(saved as EnrollmentData);
          // Resume from saved step
          const savedStep = (saved.enrollment_step ?? 1) - 1;
          setCurrentStep(Math.max(0, Math.min(savedStep, STEPS.length - 1)));
        }
      })
      .catch(() => {}); // silently ignore — start from scratch
  }, [open, conversationId]);

  const handleStepSubmit: StepSubmitFn = useCallback(
    async (fields, label) => {
      const nextStep = currentStep + 1;
      const merged: EnrollmentData = {
        ...enrollData,
        ...fields,
        conversation_id: conversationId ?? undefined,
        enrollment_step: nextStep,
      };
      setEnrollData(merged);

      // Persist to backend
      try {
        await fetch("/api/enrollment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(merged),
        });
      } catch {
        // Non-fatal — local state is still updated
      }

      // Post step summary as chat message
      onStepMessage(label);

      if (nextStep >= STEPS.length) {
        setDone(true);
      } else {
        setCurrentStep(nextStep);
      }
    },
    [currentStep, enrollData, conversationId, onStepMessage]
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
              <div className="text-3xl mb-3">🎉</div>
              <p className="font-semibold text-slate-800">Application submitted!</p>
              <p className="text-sm text-slate-500 mt-1">
                Your application is now pending review. An admin will contact you to verify your documents.
              </p>
              <Button className="mt-4 bg-sky-600 hover:bg-sky-700 text-white" onClick={onClose}>
                Close
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
