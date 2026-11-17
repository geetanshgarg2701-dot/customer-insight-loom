import type { Metadata } from "next";
import { Nav } from "../nav";

export const metadata: Metadata = {
  title: "Terms | Evidence ledger",
  description: "The plain terms for using this free early version.",
};

export default function TermsPage() {
  return (
    <main>
      <Nav />
      <h1>Terms</h1>
      <p>Last updated 17 November 2026. These are the plain terms for this free, early version.</p>

      <section aria-labelledby="what">
        <h2 id="what">What this is</h2>
        <p>
          A free tool for planning, recording and reading email experiments. It is an early version, offered as it is,
          and it can change or disappear without notice.
        </p>
      </section>

      <section aria-labelledby="as-is">
        <h2 id="as-is">No warranty</h2>
        <p>
          The app is provided without any promise that it is correct, complete or fit for a purpose. The statistics are
          tested against generated data and known textbook values, and the methods page shows the counts, but a test is
          not a guarantee for your data. Check anything important yourself before you act on it.
        </p>
      </section>

      <section aria-labelledby="use">
        <h2 id="use">How the results should be used</h2>
        <ul>
          <li>A result is an estimate with its uncertainty shown. It is not proof, and it is not advice.</li>
          <li>
            A result that says inconclusive does not mean there was no effect. It means the data could not tell.
          </li>
          <li>
            Choosing how to read a result after seeing the data weakens it. The ledger records the plan before the send
            so you can tell the difference.
          </li>
        </ul>
      </section>

      <section aria-labelledby="yours">
        <h2 id="yours">Your data and your responsibility</h2>
        <ul>
          <li>You are responsible for having the right to use any data you load.</li>
          <li>
            You are responsible for following the rules that apply to your email, such as consent and unsubscribe. The
            app does not check them.
          </li>
          <li>Keep your ledger exports safe. The app does not keep a copy for you, so a lost file cannot be recovered.</li>
        </ul>
      </section>

      <section aria-labelledby="liability">
        <h2 id="liability">Limit of responsibility</h2>
        <p>
          To the extent the law allows, nobody who makes this app is liable for any loss that comes from using it or from
          being unable to use it.
        </p>
      </section>

      <p>
        These terms are written in plain words for an early free tool. They are not a substitute for legal review, which
        a public launch should have.
      </p>
    </main>
  );
}
