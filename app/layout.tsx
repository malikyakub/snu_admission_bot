import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/Toast";
import { AdminSessionRedirect } from "@/components/AdminSessionRedirect";
import { Analytics } from "@vercel/analytics/react";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL('https://snubot.vercel.app'),
  title: "SNUBot — Somali National University Admissions Assistant",
  description: "Get instant answers about SNU faculties, admission requirements, fees, the entrance exam, and enrollment — no waiting for office hours.",
  openGraph: {
    title: "SNUBot — Somali National University Admissions Assistant",
    description: "Get instant answers about SNU faculties, admission requirements, fees, the entrance exam, and enrollment — no waiting for office hours.",
    images: ["/snu-logo.png"],
    type: "website",
  },
  icons: {
    icon: "/snu-emblem.png",
    apple: "/snu-emblem.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("h-full font-roboto", geist.variable)}>
      <body className="h-full m-0 font-roboto">
        <ToastProvider>
          <AdminSessionRedirect />
          {children}
          <Analytics />
        </ToastProvider>
      </body>
    </html>
  );
}
