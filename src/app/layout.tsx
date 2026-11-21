import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "Customer Insight Loom",
  description:
    "A free ledger for email experiments. Record the bet before you send, hold back a control group, and read the result once, with the uncertainty shown.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a href="#content" className="skip">
          Skip to content
        </a>
        <div className="shell">
          <Nav />
          <div className="content" id="content" tabIndex={-1}>
            {children}
            <footer aria-label="Site">
              <Link href="/privacy">Privacy</Link> <Link href="/terms">Terms</Link>
              <span> Early version. Free, and offered as it is.</span>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
