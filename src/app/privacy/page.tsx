import type { Metadata } from "next";
import { Nav } from "../nav";

export const metadata: Metadata = {
  title: "Privacy | Evidence ledger",
  description: "What this app does with your files and your data, in plain words.",
};

export default function PrivacyPage() {
  return (
    <main>
      <Nav />
      <h1>Privacy</h1>
      <p>Last updated 17 November 2026. This describes the early version of the app, which is what you are using.</p>

      <section aria-labelledby="short">
        <h2 id="short">The short version</h2>
        <p>
          Your files stay in your browser. The app reads them on your computer, in memory, and nothing you load is sent
          to us or to anyone else. There is no account, no tracking and no advertising.
        </p>
      </section>

      <section aria-labelledby="files">
        <h2 id="files">What happens to a file you load</h2>
        <ul>
          <li>
            A CSV you choose is read by a database that runs inside your browser, on your own computer. It is never
            uploaded.
          </li>
          <li>
            It is held in memory only. Closing or reloading the page clears it. The app does not save your data between
            visits.
          </li>
          <li>
            Columns that look like names, emails, phone numbers or addresses are blocked from being loaded for analysis.
            An email address in a file you give the app for assignment is turned into a keyed code in your browser, the
            address is dropped, and only the code is kept.
          </li>
          <li>
            A ledger export is a file you save yourself. It holds your entries and their results. It does not hold email
            addresses, only the codes. A code is not anonymous, because an address can be guessed and checked against it,
            so keep the file as carefully as you would keep the list.
          </li>
        </ul>
      </section>

      <section aria-labelledby="stored">
        <h2 id="stored">What the app stores or sends</h2>
        <ul>
          <li>It does not use cookies, local storage or any other store in your browser.</li>
          <li>It makes no network requests of its own. The database files it needs are served from the same site.</li>
          <li>It has no analytics, no error reporting, no advertising and no outside fonts or scripts.</li>
        </ul>
        <p>
          These statements are checked by an automated test that fails if the code starts using a storage, cookie or
          network feature.
        </p>
      </section>

      <section aria-labelledby="host">
        <h2 id="host">What the website host can see</h2>
        <p>
          The site is delivered by a hosting service. Like any website, the host can see that a visit happened, with the
          usual details a web server records, such as the time, the page and the network address. It cannot see the
          files you load, because they never leave your browser. This app does not control what the host records.
        </p>
      </section>

      <section aria-labelledby="demo">
        <h2 id="demo">Demo data</h2>
        <p>
          The demo data on the ledger, journeys and pipeline screens is generated in your browser. It contains no real
          people. Demo email addresses use a reserved domain, so none can reach anyone.
        </p>
      </section>

      <section aria-labelledby="limits">
        <h2 id="limits">What this app does not do</h2>
        <ul>
          <li>
            It does not remove personal names from text. Do not load free text that contains names you are not allowed to
            process.
          </li>
          <li>
            It has not been tried on real customer data. Use the demo data to see how it works, and check with whoever is
            responsible for your customers&apos; data before you use your own.
          </li>
          <li>It is not legal advice, and it does not check whether you have consent to email anyone.</li>
        </ul>
      </section>
    </main>
  );
}
