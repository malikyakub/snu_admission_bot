"use client";

import { useState } from "react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { DatePartsInput } from "@/components/DatePartsInput";
import { PhoneInput } from "@/components/PhoneInput";

/**
 * Visual QA page for shadcn overlays.
 * Loud patterned background makes transparent / bg-less panels obvious.
 */
export default function TestComponentsPage() {
  const [cert, setCert] = useState("");
  const [campus, setCampus] = useState("");
  const [dob, setDob] = useState<string | null>("2005-01-15");
  const [phone, setPhone] = useState("");

  return (
    <div
      className="min-h-full p-6 md:p-10"
      style={{
        backgroundColor: "#c026d3",
        backgroundImage:
          "repeating-linear-gradient(45deg, #facc15 0 12px, #c026d3 12px 24px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.12) 0 8px, transparent 8px 16px)",
      }}
    >
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="rounded-xl border-2 border-black/20 bg-black/40 p-4 text-white backdrop-blur-sm">
          <h1 className="text-2xl font-bold tracking-tight">Component test lab</h1>
          <p className="mt-1 text-sm text-white/90">
            Magenta + yellow stripes = intentional. If a control or dropdown shows
            the stripes through it, that component is missing a solid background.
          </p>
          <p className="mt-2 text-xs text-white/70">Route: /test</p>
        </header>

        <Section title="Input + Label">
          <div className="grid gap-2">
            <Label htmlFor="test-name">Full name</Label>
            <Input id="test-name" placeholder="Type here — should be solid white" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="test-phone">Phone</Label>
            <PhoneInput id="test-phone" value={phone} onChange={setPhone} />
          </div>
        </Section>

        <Section title="Select (open these — menus must be opaque)">
          <div className="grid gap-2">
            <Label>Certificate type</Label>
            <Select value={cert} onValueChange={(v) => setCert(v ?? "")}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Select certificate type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sssc">Somali Secondary School Certificate</SelectItem>
                <SelectItem value="national">National Exam Certificate</SelectItem>
                <SelectItem value="olevel">O-Level / IGCSE</SelectItem>
                <SelectItem value="other">Other Recognized Certificate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Campus</Label>
            <Select value={campus} onValueChange={(v) => setCampus(v ?? "")}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Select campus" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main">Main Campus</SelectItem>
                <SelectItem value="gaheyr">Gaheyr</SelectItem>
                <SelectItem value="km4">KM4</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Section>

        <Section title="Custom date picker (Month | Day | Year)">
          <Label>Date of birth</Label>
          <DatePartsInput value={dob} onChange={setDob} />
          <p className="text-xs font-medium text-white drop-shadow">
            ISO value: {dob ?? "(incomplete)"}
          </p>
        </Section>

        <Section title="Popover">
          <Popover>
            <PopoverTrigger className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800">
              Open popover
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <p className="font-medium text-slate-900">Popover panel</p>
              <p className="mt-1 text-sm text-slate-600">
                This surface should be solid white. If you see stripes behind this
                text, the popover background is broken.
              </p>
            </PopoverContent>
          </Popover>
        </Section>

        <Section title="Sheet">
          <Sheet>
            <SheetTrigger className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800">
              Open sheet
            </SheetTrigger>
            <SheetContent side="right" className="bg-white">
              <SheetHeader>
                <SheetTitle>Sheet panel</SheetTitle>
              </SheetHeader>
              <p className="mt-4 px-4 text-sm text-slate-600">
                Sheet body should be solid white over the striped page.
              </p>
              <div className="px-4 pb-4">
                <Input className="mt-4" placeholder="Field inside sheet" />
              </div>
            </SheetContent>
          </Sheet>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline" className="bg-white">
              Outline
            </Button>
            <Button variant="ghost" className="bg-white/90">
              Ghost
            </Button>
            <Button variant="destructive">Destructive</Button>
          </div>
        </Section>

        <p className="text-center text-xs font-medium text-black/70">
          Tip: open every dropdown/popover/sheet. Stripes showing through = bug.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border-2 border-dashed border-black/30 bg-black/25 p-4 backdrop-blur-[2px]">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white drop-shadow">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
