"use client";

import { useState } from "react";
import { HYPOTHESES, findBrackets, fillHypothesis, hypothesisById, startFrom } from "@/lib/ledger/hypotheses";

/**
 * Starts a ledger draft from a behavioral idea. Choosing one puts its title and hypothesis in the form with [brackets]
 * to fill. The idea is a starting point, not evidence that it works.
 */
export function HypothesisPicker({
  title,
  hypothesis,
  setTitle,
  setHypothesis,
}: {
  title: string;
  hypothesis: string;
  setTitle: (v: string) => void;
  setHypothesis: (v: string) => void;
}) {
  const [id, setId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const idea = id === "" ? undefined : hypothesisById(id);
  const brackets = idea ? startFrom(idea).brackets : [];
  const left = findBrackets(`${title}\n${hypothesis}`);

  function choose(next: string) {
    setId(next);
    setValues({});
    const h = next === "" ? undefined : hypothesisById(next);
    if (!h) return;
    const s = startFrom(h);
    setTitle(s.title);
    setHypothesis(s.hypothesis);
  }

  function fill() {
    if (!idea) return;
    setTitle(fillHypothesis(idea.titleTemplate, values).text);
    setHypothesis(fillHypothesis(idea.hypothesisTemplate, values).text);
  }

  return (
    <fieldset>
      <legend>Start from an idea, optional</legend>
      <p>
        <label>
          Behavioral idea{" "}
          <select value={id} onChange={(e) => choose(e.target.value)}>
            <option value="">None, I will write my own</option>
            {HYPOTHESES.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        Choosing an idea replaces the Title and Hypothesis below with a prediction to complete. An idea is a reason to
        run a test. It is not evidence that it works, and it says nothing about how much.
      </p>
      {idea && (
        <div>
          <p>
            <strong>The idea.</strong> {idea.idea}
          </p>
          <p>
            <strong>What to measure.</strong> {idea.primaryMetric}
          </p>
          <p>
            <strong>Use it honestly.</strong> {idea.watchOut}
          </p>
          <p>Fill each blank in your own words, then press the button. It rewrites the Title and Hypothesis from the idea.</p>
          {brackets.map((b) => (
            <p key={b}>
              <label>
                {b.charAt(0).toUpperCase() + b.slice(1)}{" "}
                <input type="text" value={values[b] ?? ""} maxLength={80} onChange={(e) => setValues((v) => ({ ...v, [b]: e.target.value }))} />
              </label>
            </p>
          ))}
          <p>
            <button type="button" onClick={fill}>
              Fill in the brackets
            </button>
          </p>
        </div>
      )}
      {left.length > 0 && (
        <p role="status">
          Still to fill in the Title or Hypothesis: {left.join(", ")}. A draft can keep them, but replace them before you
          register, because registering locks the entry.
        </p>
      )}
    </fieldset>
  );
}
