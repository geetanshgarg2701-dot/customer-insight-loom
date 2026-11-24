"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { clampStep, isLast, progressText, TOUR, TOUR_LENGTH } from "@/lib/app/tour";
import { seedBrowserDemo } from "@/lib/duckdb/client";

/**
 * The tour opens only when someone asks for it, so it never covers the headline on arrival. The hint says New here until it has
 * been opened. Nothing is stored, so a reload starts over.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

type Demo = { state: "idle" | "loading" | "done" | "error"; text?: string };

export function GuidedTour() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [opened, setOpened] = useState(false);
  const [demo, setDemo] = useState<Demo>({ state: "idle" });

  function open() {
    setStep(0);
    setOpened(true);
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }
  function close() {
    dialog.current?.close();
  }

  async function loadDemo() {
    setDemo({ state: "loading" });
    try {
      await seedBrowserDemo();
      setDemo({ state: "done" });
    } catch (e) {
      setDemo({ state: "error", text: messageOf(e) });
    }
  }

  const i = clampStep(step);
  const current = TOUR[i];
  const last = isLast(i);

  return (
    <>
      <p className="tour-hint">
        {!opened && "New here? "}
        <button type="button" onClick={open}>
          Take the 2 minute tour
        </button>
      </p>
      <dialog ref={dialog} className="tour" aria-label="Quick tour of the app">
        <p className="tour-progress">{progressText(i)}</p>
        <div className="tour-bar" aria-hidden="true">
          <span style={{ width: `${((i + 1) / TOUR_LENGTH) * 100}%` }} />
        </div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>

        {current.action.kind === "demo" && (
          <div>
            {demo.state === "done" ? (
              <p role="status">
                Loaded 4 synthetic demo experiments. <Link href="/ledger">Open the Ledger</Link> to look at them, or carry on with the tour.
              </p>
            ) : (
              <p>
                <button type="button" disabled={demo.state === "loading"} onClick={() => void loadDemo()}>
                  {demo.state === "loading" ? "Loading the demo" : "Load the demo ledger"}
                </button>
              </p>
            )}
            {demo.state === "error" && (
              <p role="alert">
                The demo could not be loaded: {demo.text} If the ledger already has entries, reload the page to start with an empty one.
              </p>
            )}
          </div>
        )}
        {current.action.kind === "link" && (
          <p>
            <Link href={current.action.href} className="button-link">
              {current.action.label}
            </Link>
          </p>
        )}

        <div className="tour-actions">
          <button type="button" disabled={i === 0} onClick={() => setStep(i - 1)}>
            Back
          </button>
          {last ? (
            <button type="button" onClick={close}>
              Finish
            </button>
          ) : (
            <button type="button" onClick={() => setStep(i + 1)}>
              Next
            </button>
          )}
          <button type="button" className="grow" onClick={close}>
            Skip the tour
          </button>
        </div>
      </dialog>
    </>
  );
}
