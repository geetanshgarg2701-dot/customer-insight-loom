/**
 * What the page shows while 100,000 rows load: the shape of what is coming, so the page does not jump when it arrives, and one
 * plain line that says what is happening. The pulse is slow and soft, and it stops under reduced motion.
 */
export function LoadingSkeleton({ text }: { text: string }) {
  return (
    <div role="status" aria-busy="true" className="skeleton">
      <p>{text}</p>
      <div className="sk-progress" aria-hidden="true">
        <span />
      </div>
      <div className="sk-tiles" aria-hidden="true">
        <i className="sk" />
        <i className="sk" />
        <i className="sk" />
        <i className="sk" />
      </div>
      <i className="sk sk-chart" aria-hidden="true" />
      <i className="sk sk-chart" aria-hidden="true" />
    </div>
  );
}
