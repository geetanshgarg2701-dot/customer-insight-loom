import Link from "next/link";

/** Plain links between screens. Client side links keep the in-browser ledger alive. */
export function Nav() {
  return (
    <nav aria-label="Main">
      <Link href="/">Home</Link> <Link href="/intake">Data intake</Link> <Link href="/ledger">Ledger</Link> <Link href="/journeys">Journeys</Link> <Link href="/pipeline">Pipeline</Link> <Link href="/insights">Comments</Link> <Link href="/compliance">Email check</Link> <Link href="/ingest">Webhooks</Link> <Link href="/check">Data check</Link> <Link href="/methods">Methods</Link> <Link href="/data">Your data</Link>
    </nav>
  );
}
