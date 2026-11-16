/**
 * The only thing the intake logic needs from a SQL engine. The browser build
 * backs it with DuckDB-Wasm in a Web Worker. Tests back it with the Node build.
 */
export interface SqlEngine {
  registerFile(name: string, bytes: Uint8Array): Promise<void>;
  dropFile(name: string): Promise<void>;
  exec(sql: string): Promise<void>;
  all(sql: string): Promise<Record<string, unknown>[]>;
  close?(): Promise<void>;
}

export type Header = {
  index: number;
  /** The header text exactly as written in the file, minus any byte order mark. */
  name: string;
  /** True when the shared redaction rule blocks this column. */
  blocked: boolean;
};

export type MappingEntry = {
  /** Position of the source column in the file. */
  source: number;
  /** The name the loaded column will have. */
  target: string;
  include: boolean;
};

export type SkipReason = "too_few_fields" | "too_many_fields";

export type LoadResult = {
  /** Rows that were loaded. */
  rowCount: number;
  skipped: {
    tooFewFields: number;
    tooManyFields: number;
    /** The first skipped rows. Row 1 is the first row after the header. */
    examples: { row: number; reason: SkipReason }[];
  };
};

export type Preview = {
  columns: string[];
  /** Empty fields are null. Long cells are clipped. */
  rows: (string | null)[][];
  /** Total rows loaded, not just the rows shown. */
  rowCount: number;
};

export interface Intake {
  /** Reads the header row only. No data row is loaded and nothing is previewed. */
  open(bytes: Uint8Array): Promise<Header[]>;
  /** Loads the included columns. Throws BlockedColumnError for a blocked column. */
  load(mapping: MappingEntry[]): Promise<LoadResult>;
  preview(): Promise<Preview>;
  close(): Promise<void>;
}
