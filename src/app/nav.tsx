import Link from "next/link";
import { PILOT } from "@/lib/pilot/enabled";

/** Plain links between screens. Client side links keep the in-browser ledger alive. */
export function Nav() {
  return (
    <nav aria-label="Main">
      <Link href="/">Home</Link> <Link href="/intake">Data intake</Link> <Link href="/ledger">Ledger</Link> <Link href="/journeys">Journeys</Link> <Link href="/pipeline">Pipeline</Link> <Link href="/insights">Comments</Link> <Link href="/compliance">Email check</Link> <Link href="/drafts">Email drafts</Link> <Link href="/ingest">Webhooks</Link> <Link href="/check">Data check</Link> <Link href="/methods">Methods</Link> <Link href="/data">Your data</Link>{PILOT && <> <Link href="/account">Account</Link></>}
    </nav>
  );
}
