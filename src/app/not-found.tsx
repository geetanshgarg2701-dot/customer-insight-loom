import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="hero">
        <h1>
          <span className="line">Page not found.</span> <span className="line light">It may have moved, or the link has a typo.</span>
        </h1>
        <div className="cta">
          <Link className="button-link" href="/">
            Go to the home page
          </Link>
        </div>
      </div>
    </main>
  );
}
