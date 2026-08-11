import type { Metadata } from "next";

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
    <html lang="en">
      <body style={{ fontFamily: "Georgia, 'Times New Roman', serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
