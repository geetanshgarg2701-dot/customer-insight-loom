import Link from "next/link";

/** Plain links between screens. Client side links keep the in-browser ledger alive. */
export function Nav() {
  return (
    <nav aria-label="Main">
      <Link href="/intake">Data intake</Link> <Link href="/ledger">Ledger</Link> <Link href="/methods">Methods</Link>
    </nav>
  );
}
