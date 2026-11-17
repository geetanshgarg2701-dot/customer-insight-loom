import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Evidence ledger",
  description:
    "A free ledger for email experiments. Record the bet before you send, hold back a control group, and read the result once, with the uncertainty shown.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <footer aria-label="Site">
          <Link href="/privacy">Privacy</Link> <Link href="/terms">Terms</Link>
          <span> Early version. Free, and offered as it is.</span>
        </footer>
      </body>
    </html>
  );
}
