import type { Explanation } from "@/lib/app/explain";

/**
 * "How was this worked out", as a closed section the person can open. The words come from the explain functions, which
 * build each sentence from the real values, so what is explained is what is on screen.
 */
export function Explain({
  items,
  summary = "How these numbers were worked out",
}: {
  items: Explanation[];
  summary?: string;
}) {
  return (
    <details>
      <summary>{summary}</summary>
      <dl>
        {items.map((e) => (
          <div key={e.label}>
            <dt>
              {e.label}: {e.value}
            </dt>
            <dd>{e.how}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
