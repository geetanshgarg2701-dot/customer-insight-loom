"use client";

import { formatCount } from "@/lib/app/format";
import {
  compareFrameworks,
  MIN_ARM,
  MIN_TESTS,
  type FrameworkInput,
} from "@/lib/ledger/frameworks";

/** A relative change with a sign, for example 0.123 becomes +12.3 percent. */
function signed(x: number): string {
  if (!Number.isFinite(x)) return "not available";
  const v = Number((x * 100).toFixed(1));
  if (v === 0) return "0.0 percent";
  return `${v > 0 ? "+" : "-"}${Math.abs(v).toFixed(1)} percent`;
}

const pValue = (p: number) => (p < 0.001 ? "under 0.001" : p.toFixed(3));

/** Plan section 6.5: frameworks compared across ledger entries, as an association, never a cause. */
export function FrameworkSection({
  entries,
}: {
  entries: readonly FrameworkInput[];
}) {
  const out = compareFrameworks(entries);
  const x = out.excluded;
  const left = [
    x.noTag && `${formatCount(x.noTag)} with no framework tag`,
    x.noResult && `${formatCount(x.noResult)} with no result yet`,
    x.noCounts &&
      `${formatCount(x.noCounts)} whose result lacks counts or had no conversions in either group`,
    x.smallArm &&
      `${formatCount(x.smallArm)} with fewer than ${MIN_ARM} customers in a group`,
    x.synthetic &&
      `${formatCount(x.synthetic)} demo ${x.synthetic === 1 ? "entry" : "entries"}`,
  ].filter(Boolean);

  return (
    <section aria-labelledby="h-frameworks">
      <h2 id="h-frameworks">Frameworks compared across tests</h2>
      <p role="status">{out.text}</p>
      <div style={{ overflowX: "auto" }}>
        <table aria-label="Lift by framework">
          <thead>
            <tr>
              <th scope="col">Framework</th>
              <th scope="col">Tests</th>
              <th scope="col">Pooled lift, relative</th>
              <th scope="col">95 percent interval</th>
              <th scope="col">Spread between tests</th>
            </tr>
          </thead>
          <tbody>
            {out.groups.map((g) => (
              <tr key={g.tag}>
                <th scope="row">{g.tag}</th>
                <td>{formatCount(g.tests)}</td>
                {g.pooled ? (
                  <>
                    <td>{signed(g.pooled.relativeLift)}</td>
                    <td>
                      {signed(g.pooled.liftLow)} to {signed(g.pooled.liftHigh)}
                    </td>
                    <td>
                      {Math.round(g.pooled.i2 * 100)} percent of the spread is
                      beyond chance
                    </td>
                  </>
                ) : (
                  <td colSpan={3}>
                    Too few tests, at least {MIN_TESTS} are needed
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {out.pairs.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table aria-label="Framework pairs">
            <thead>
              <tr>
                <th scope="col">Pair</th>
                <th scope="col">Difference, relative</th>
                <th scope="col">95 percent interval, not adjusted</th>
                <th scope="col">p value, Holm adjusted</th>
                <th scope="col">Reading</th>
              </tr>
            </thead>
            <tbody>
              {out.pairs.map((p) => (
                <tr key={`${p.a}-${p.b}`}>
                  <th scope="row">
                    {p.a} against {p.b}
                  </th>
                  <td>{signed(p.difference)}</td>
                  <td>
                    {signed(p.low)} to {signed(p.high)}
                  </td>
                  <td>{pValue(p.adjusted)}</td>
                  <td>
                    {p.flagged
                      ? "Differs, as an association"
                      : "No difference shown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {left.length > 0 && <p>Left out: {left.join(", ")}.</p>}
      <details>
        <summary>How this is worked out</summary>
        <p>{out.method}</p>
        <p>
          Lift here is relative: +10 percent means the treatment group converted
          at 1.1 times the control rate. Tests with different baseline rates are
          put on that one scale. Each test counts by how precise it was and by
          how much tests differ from each other, so one large test cannot speak
          for a whole framework.
        </p>
      </details>
    </section>
  );
}
