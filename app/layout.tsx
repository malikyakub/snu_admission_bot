import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { ToastProvider } from "@/components/Toast";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "SNUBot",
  description: "Somali National University admissions assistant",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn("h-full font-roboto", geist.variable)}>
      <body className="h-full m-0 font-roboto">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
