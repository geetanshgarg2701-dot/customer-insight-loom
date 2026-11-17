import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evidence ledger",
  description:
    "A free ledger for email experiments. Record the bet before you send, hold back a control group, and read the result once, with the uncertainty shown.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
