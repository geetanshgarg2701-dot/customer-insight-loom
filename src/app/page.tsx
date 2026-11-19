import Link from "next/link";
import { Nav } from "./nav";

export default function Home() {
  return (
    <main>
      <Nav />
      <h1>Customer Insight Loom</h1>
      <p>
        Customer journeys, pipelines and email experiments, woven into one picture with the evidence kept and the
        uncertainty shown. It is free. The ledger records each experiment: you write down the bet before you send,
        hold back a control group, and read the result once, after the conversion window closes. When a result is too
        small to tell, it says so plainly.
      </p>
      <p>
        Your files stay in your browser. There is no account, and nothing you load is sent to a server. See <Link href="/privacy">Privacy</Link> for the details.
      </p>

      <section aria-labelledby="today">
        <h2 id="today">What works today</h2>
        <ul>
          <li>
            <Link href="/ledger">Ledger</Link>. Write down a hypothesis, check that your audience is large enough,
            assign a holdout, and read out the result. The demo data on that page shows the whole path.
          </li>
          <li>
            <Link href="/intake">Data intake</Link>. Load a CSV, map its columns, and preview 20 rows. Columns that
            look like names, emails or phone numbers are blocked.
          </li>
          <li>
            <Link href="/journeys">Journeys</Link>. Linked charts of where customers drop off, on synthetic data.
          </li>
          <li>
            <Link href="/pipeline">Pipeline</Link>. Where deals wait, how long they sit in each stage, and which ones
            have stalled, on synthetic data.
          </li>
          <li>
            <Link href="/insights">Comments</Link>. What customers say, read next to what they did, with a redaction
            scorecard and a step to correct a comment, on synthetic data.
          </li>
          <li>
            <Link href="/check">Data check</Link>. Match two files on email and check a time column against clock
            changes, in the browser.
          </li>
          <li>
            <Link href="/methods">Methods</Link>. The checks that ran on generated data to test the calculator, with
            the counts.
          </li>
        </ul>
      </section>

      <p>
        This is an early version. It has not been tried on real customer data, and names are not removed from text
        yet. Use the demo data to see how it works.
      </p>
    </main>
  );
}
