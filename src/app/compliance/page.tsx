"use client";

import { CHECKED } from "@/lib/compliance/rules";
import { EmailCheckForm } from "./email-check-form";

export default function CompliancePage() {
  return (
    <main>
      <h1>Email check</h1>
      <p>
        Check a marketing email against US email law and the Gmail and Yahoo sender rules before it goes out. Each rule
        shows its source and the date it was checked, {CHECKED}. Sending is not approved while a rule fails or a
        statement only you can make is not ticked. Nothing you type here is stored or sent anywhere.
      </p>
      <p>
        This is not legal advice. It covers US commercial email only. GDPR and CASL checks are not built. To launch a
        ledger entry, run this check on the entry&rsquo;s own page, where a pass is recorded in its history.
      </p>
      <EmailCheckForm />
    </main>
  );
}
