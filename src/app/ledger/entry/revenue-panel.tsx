"use client";

import type { RevenueReadout } from "@/lib/stats/revenue";

const money = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (x: number) => (x > 0 ? `+${money(x)}` : money(x));

/**
 * Revenue per recipient next to the lift. It is shown only when the file reports revenue for everyone who converted, and
 * it never turns lift into revenue by multiplying by one order value, which gets the sign wrong when a send changes the
 * size of orders.
 */
export function RevenuePanel({ revenue }: { revenue: RevenueReadout }) {
  return (
    <section aria-labelledby="h-revenue">
      <h3 id="h-revenue">Revenue per recipient</h3>
      {revenue.status === "not_shown" && <p>Revenue is not shown. {revenue.text}</p>}
      {revenue.status === "means_only" && <p>{revenue.text}</p>}
      {(revenue.status === "means_only" || revenue.status === "shown") && (
        <div style={{ overflowX: "auto" }}>
          <table aria-label="Revenue per recipient">
            <tbody>
              <tr>
                <th scope="row">Treatment, per recipient</th>
                <td>
                  {money(revenue.treatment.perRecipient)}, {revenue.treatment.n.toLocaleString("en-US")} people, {revenue.treatment.purchasers.toLocaleString("en-US")} purchases
                </td>
              </tr>
              <tr>
                <th scope="row">Control, per recipient</th>
                <td>
                  {money(revenue.control.perRecipient)}, {revenue.control.n.toLocaleString("en-US")} people, {revenue.control.purchasers.toLocaleString("en-US")} purchases
                </td>
              </tr>
              <tr>
                <th scope="row">Difference, per recipient</th>
                <td>{signed(revenue.difference)}</td>
              </tr>
              {revenue.status === "shown" && (
                <>
                  <tr>
                    <th scope="row">{Math.round((1 - revenue.alpha) * 100)} percent interval</th>
                    <td>
                      {signed(revenue.low)} to {signed(revenue.high)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Over the {revenue.overTreated.n.toLocaleString("en-US")} treated people measured</th>
                    <td>
                      {signed(revenue.overTreated.estimate)}, from {signed(revenue.overTreated.low)} to {signed(revenue.overTreated.high)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
      {revenue.status === "shown" && (
        <>
          <p>
            {revenue.significant
              ? "The interval does not include zero."
              : "The interval includes zero, so this does not show that revenue per recipient differs."}{" "}
            The last row is the difference per recipient times the treated people measured. It is not a forecast.
          </p>
          <p>Method: {revenue.method}</p>
        </>
      )}
      {revenue.notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </section>
  );
}
