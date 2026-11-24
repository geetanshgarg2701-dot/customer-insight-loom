import { funnelPath, funnelSentence, heroFunnel } from "@/lib/app/hero-funnel";

/** The faded picture on the home screen: the synthetic journeys as one shape, drawn when the page is built. */
export function HeroFunnel() {
  const steps = heroFunnel();
  return (
    <figure className="hero-funnel">
      <svg viewBox="0 0 1000 320" preserveAspectRatio="none" role="img" aria-label={funnelSentence(steps)}>
        <path d={funnelPath(steps.map((s) => s.count), 1000, 320)} fill="currentColor" fillOpacity="0.18" />
      </svg>
      <dl>
        {steps.map((s) => (
          <div key={s.name}>
            <dt>{s.name}</dt>
            <dd>{s.count.toLocaleString("en-US")}</dd>
          </div>
        ))}
      </dl>
      <figcaption>Synthetic example from the demo data.</figcaption>
    </figure>
  );
}
