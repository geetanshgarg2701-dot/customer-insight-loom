"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserIntake } from "@/lib/duckdb/client";
import type { Header, Intake } from "@/lib/intake/types";

/** Intake registers one fixed file name, so only one uploaded file may be open at a time. */
let active: Intake | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Reads the header of an uploaded CSV and later the chosen columns, for
 * matching only. Raw values go to the caller to hash or compare at once.
 * Nothing here is shown on screen or stored.
 */
export function useCsvColumns() {
  const intakeRef = useRef<Intake | null>(null);
  const [headers, setHeaders] = useState<Header[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const holder = intakeRef;
    return () => {
      const intake = holder.current;
      holder.current = null;
      if (intake) {
        if (active === intake) active = null;
        void intake.close();
      }
    };
  }, []);

  async function open(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setHeaders(null);
    setFileName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (active && active !== intakeRef.current) await active.close();
      intakeRef.current ??= await createBrowserIntake();
      active = intakeRef.current;
      setHeaders(await intakeRef.current.open(bytes));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  /** Raw values of the chosen columns. Ragged rows are skipped and counted. */
  async function read(indices: number[]) {
    const intake = intakeRef.current;
    if (!intake) throw new Error("Choose a file first.");
    return intake.readColumnsForMatching(indices);
  }

  /** Releases the uploaded file and its copy in the browser database. */
  async function release() {
    const intake = intakeRef.current;
    intakeRef.current = null;
    if (intake) {
      if (active === intake) active = null;
      await intake.close();
    }
    setHeaders(null);
    setFileName(null);
  }

  return { headers, fileName, error, busy, open, read, release, setError };
}
