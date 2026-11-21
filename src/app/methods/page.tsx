"use client";

import { useEffect, useState } from "react";
import { formatPercent, formatPoints } from "@/lib/app/format";
import { METHOD_NOTES, REDACTION_LIMITS, runMethodsReport, type MethodsReport } from "@/lib/methods/report";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

const yesNo = (v: boolean) => (v ? "yes" : "no");

export default function MethodsPage() {
  const [report, setReport] = useState<MethodsReport | null>(null);
  const [step, setStep] = useState("Starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await runMethodsReport({
          onProgress: (s) => {
            if (!cancelled) setStep(s);
          },
        });
        if (!cancelled) setReport(result);
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const aa = report?.aa;
  const p = report?.planted;
  const red = report?.redaction;

  return (
    <main>
      <h1>Methods</h1>
      <p>
        {report?.note ?? "These checks ran on generated data. They verify the calculator, not any real world result."}
      </p>
      <p>
        The counts below are computed in this browser, now, by the same code the ledger uses. The seeds are fixed, so
        the numbers are the same on every load and anyone can reproduce them.
      </p>
      {error && <p role="alert">{error}</p>}
      {!report && !error && <p role="status">Running the checks: {step}</p>}

      {aa && p && red && report && (
        <>
          <p>
            Stats engine version {report.statsEngineVersion}. Redaction rule version {red.ruleVersion}.
          </p>

          <section aria-labelledby="aa-h">
            <h2 id="aa-h">A/A simulation</h2>
            <p>
              Both arms draw from the same conversion rate, so every significant call is a false positive. About 5 in
              100 are expected.
            </p>
            <table aria-label="A/A simulation">
              <tbody>
                <Row label="Experiments">{aa.experiments}</Row>
                <Row label="People per arm">{aa.nPerArm}</Row>
                <Row label="Conversion rate, both arms">{formatPercent(aa.rate)}</Row>
                <Row label="Called significant">
                  {aa.significantCount} of {aa.experiments}
                </Row>
                <Row label="Expected">about {aa.expectedCount}</Row>
                <Row label="Acceptance band">
                  {aa.band.low} to {aa.band.high}
                </Row>
                <Row label="Inside the band">{yesNo(aa.withinBand)}</Row>
                <Row label="Seed">{aa.seed}</Row>
              </tbody>
            </table>
            {!aa.withinBand && <p>The count is outside the band, so the engine needs fixing before launch.</p>}
            <p>Method: {aa.method}</p>
          </section>

          <section aria-labelledby="planted-h">
            <h2 id="planted-h">Planted lift simulation</h2>
            <p>
              Each experiment has a known true lift and is sized by the power check, so the check&apos;s own promise is
              tested at its own sample size.
            </p>
            <table aria-label="Planted lift simulation">
              <tbody>
                <Row label="Experiments">{p.experiments}</Row>
                <Row label="Baseline rate">{formatPercent(p.baselineRate)}</Row>
                <Row label="True lift">{formatPoints(p.lift)}</Row>
                <Row label="People per experiment">
                  {p.nTreatment} treatment, {p.nControl} control
                </Row>
                <Row label="Interval contained the true lift">
                  {p.coverageCount} of {p.experiments}
                </Row>
                <Row label="Expected coverage">
                  about {p.expectedCoverage}, band {p.coverageBand.low} to {p.coverageBand.high}
                </Row>
                <Row label="Coverage inside the band">{yesNo(p.coverageWithinBand)}</Row>
                <Row label="Lift detected">
                  {p.detectedCount} of {p.experiments}
                </Row>
                <Row label="Promised by the power check">
                  about {p.promisedCount}, lowest consistent count {p.promiseFloor}
                </Row>
                <Row label="Power promise held">{yesNo(p.promiseHeld)}</Row>
                <Row label="Seed">{p.seed}</Row>
              </tbody>
            </table>
            {(!p.coverageWithinBand || !p.promiseHeld) && (
              <p>At least one count is outside its band, so the engine needs fixing before launch.</p>
            )}
            <p>Method: {p.method}</p>
          </section>

          <section aria-labelledby="redaction-h">
            <h2 id="redaction-h">Redaction planted set</h2>
            <p>
              200 fake items, 50 per type, written before the redactor existed. Caught means a finding of the right
              type covers the whole value. The set includes formats a simple rule set is expected to miss, so the
              misses are real.
            </p>
            <table aria-label="Redaction results">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Planted</th>
                  <th>Caught</th>
                  <th>Missed</th>
                </tr>
              </thead>
              <tbody>
                {red.scores.map((s) => (
                  <tr key={s.type}>
                    <th scope="row">{s.type}</th>
                    <td>{s.total}</td>
                    <td>{s.caught}</td>
                    <td>{s.missed}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">all</th>
                  <td>{red.total}</td>
                  <td>{red.caught}</td>
                  <td>{red.missed}</td>
                </tr>
              </tbody>
            </table>
            <h3>What was missed</h3>
            <ul aria-label="Missed items">
              {red.missedItems.map((m) => (
                <li key={m.id}>
                  {m.type}, format {m.variant}, {m.reason === "partial" ? "partly matched" : "not detected"}
                </li>
              ))}
            </ul>
            <h3>Limits</h3>
            <ul aria-label="Redaction limits">
              {REDACTION_LIMITS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="how-h">
            <h2 id="how-h">How each number is computed</h2>
            <dl>
              {METHOD_NOTES.map((n) => (
                <div key={n.name}>
                  <dt>{n.name}</dt>
                  <dd>{n.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </main>
  );
}
