import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>There is nothing at this address. It may have been moved, or the link may have a typo.</p>
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
    </main>
  );
}
