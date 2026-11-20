import { afterEach, describe, expect, it } from "vitest";
import { createNodeEngine } from "../intake/testing/node-engine";
import type { SqlEngine } from "../intake/types";
import { createLedger } from "../ledger/ledger";
import { assertProjectOrigin, pilotConfig } from "./config";
import {
  MAX_NAME,
  MIN_PASSWORD,
  PilotError,
  checkProject,
  deleteAllProjects,
  loadChecked,
  login,
  register,
  saveCurrent,
  type PilotApi,
  type ProjectRow,
} from "./service";

let engines: SqlEngine[] = [];
afterEach(async () => {
  for (const e of engines) await e.close?.();
  engines = [];
});

async function realExport(): Promise<Record<string, unknown>> {
  const engine = await createNodeEngine({ isolated: true });
  engines.push(engine);
  const ledger = await createLedger(engine, {});
  await ledger.createDraft({ title: "Pilot entry", hypothesis: "H" }, "user_1");
  return JSON.parse(JSON.stringify(await ledger.exportFile())) as Record<string, unknown>;
}

/** A fake cloud that records what it was asked, with no network. */
function fakeApi(opts: { workspace?: string | null } = {}) {
  const calls: string[] = [];
  const rows = new Map<string, { row: ProjectRow; file: unknown }>();
  const api: PilotApi = {
    async signUp() {
      calls.push("signUp");
      return { needsConfirmation: true };
    },
    async signIn() {
      calls.push("signIn");
    },
    async signOut() {
      calls.push("signOut");
    },
    async findWorkspace() {
      calls.push("findWorkspace");
      return opts.workspace === undefined ? "w1" : opts.workspace;
    },
    async createWorkspace() {
      calls.push("createWorkspace");
      return "w-new";
    },
    async listProjects() {
      return [...rows.values()].map((r) => r.row);
    },
    async saveProject(_w, name, file) {
      calls.push("saveProject");
      rows.set(name, { row: { id: `id-${name}`, name, updated_at: "2026-11-20T00:00:00Z" }, file });
    },
    async loadProject(id) {
      return [...rows.values()].find((r) => r.row.id === id)?.file;
    },
    async deleteProject(id) {
      calls.push(`delete ${id}`);
      for (const [k, v] of rows) if (v.row.id === id) rows.delete(k);
    },
  };
  return { api, calls, rows };
}

describe("pilotConfig", () => {
  const KEY = "sb_publishable_" + "x".repeat(6);
  it("is off unless both the address and the key are set", () => {
    expect(pilotConfig(undefined, undefined)).toBeNull();
    expect(pilotConfig("https://abc.supabase.co", undefined)).toBeNull();
    expect(pilotConfig(undefined, KEY)).toBeNull();
    expect(pilotConfig("", KEY)).toBeNull();
  });
  it("accepts an https address and keeps only its origin", () => {
    expect(pilotConfig("https://abc.supabase.co/rest/v1", KEY)).toEqual({ url: "https://abc.supabase.co", origin: "https://abc.supabase.co", key: KEY });
  });
  it("refuses http, credentials in the address, and nonsense", () => {
    expect(pilotConfig("http://abc.supabase.co", KEY)).toBeNull();
    expect(pilotConfig("https://user:pw@abc.supabase.co", KEY)).toBeNull();
    expect(pilotConfig("not an address", KEY)).toBeNull();
  });
  it("refuses a secret key or a service role key, which must never reach a browser", () => {
    expect(pilotConfig("https://abc.supabase.co", "sb_secret_abc")).toBeNull();
    const payload = btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "");
    expect(pilotConfig("https://abc.supabase.co", `aaa.${payload}.sig`)).toBeNull();
    const anon = btoa(JSON.stringify({ role: "anon" })).replace(/=+$/, "");
    expect(pilotConfig("https://abc.supabase.co", `aaa.${anon}.sig`)).not.toBeNull();
  });
});

describe("assertProjectOrigin", () => {
  const origin = "https://abc.supabase.co";
  it("allows the project and blocks everything else", () => {
    expect(() => assertProjectOrigin("https://abc.supabase.co/rest/v1/saved_projects", origin)).not.toThrow();
    expect(() => assertProjectOrigin("https://evil.example.org/x", origin)).toThrow(/Blocked/);
    expect(() => assertProjectOrigin("https://abc.supabase.co.evil.net/x", origin)).toThrow(/Blocked/);
    expect(() => assertProjectOrigin("http://abc.supabase.co/x", origin)).toThrow(/Blocked/);
    expect(() => assertProjectOrigin("/relative", origin)).toThrow(/Blocked/);
  });
});

describe("sign up and sign in", () => {
  it("checks the email and password before any request", async () => {
    const { api, calls } = fakeApi();
    await expect(register(api, "not-an-email", "a".repeat(MIN_PASSWORD))).rejects.toThrow(/valid email/);
    await expect(register(api, "me@example.com", "short")).rejects.toThrow(new RegExp(`${MIN_PASSWORD} characters`));
    await expect(login(api, "me@example.com", "short")).rejects.toThrow(PilotError);
    expect(calls).toEqual([]);
  });
  it("signs up with a trimmed email", async () => {
    const { api, calls } = fakeApi();
    expect(await register(api, " me@example.com ", "a".repeat(MIN_PASSWORD))).toEqual({ needsConfirmation: true });
    expect(calls).toEqual(["signUp"]);
  });
  it("signs in and uses the existing workspace, or makes one on the first sign in", async () => {
    const existing = fakeApi({ workspace: "w1" });
    expect(await login(existing.api, "me@example.com", "a".repeat(MIN_PASSWORD))).toBe("w1");
    expect(existing.calls).toEqual(["signIn", "findWorkspace"]);
    const first = fakeApi({ workspace: null });
    expect(await login(first.api, "me@example.com", "a".repeat(MIN_PASSWORD))).toBe("w-new");
    expect(first.calls).toEqual(["signIn", "findWorkspace", "createWorkspace"]);
  });
  it("does not make a workspace when sign in fails", async () => {
    const { api, calls } = fakeApi();
    api.signIn = async () => {
      throw new PilotError("Invalid login credentials");
    };
    await expect(login(api, "me@example.com", "a".repeat(MIN_PASSWORD))).rejects.toThrow(/Invalid login/);
    expect(calls).toEqual([]);
  });
});

describe("saving and loading a project", () => {
  it("saves a real ledger export and loads it back unchanged", async () => {
    const file = await realExport();
    const { api, calls } = fakeApi();
    await saveCurrent(api, "w1", "  Q4 tests ", file);
    expect(calls).toEqual(["saveProject"]);
    expect(await loadChecked(api, "id-Q4 tests")).toEqual(file);
  });
  it("refuses a bad name, a file that is not a ledger export, an oversize file and an email shaped string", async () => {
    const file = await realExport();
    expect(() => checkProject("   ", file)).toThrow(/1 to 120/);
    expect(() => checkProject("x".repeat(MAX_NAME + 1), file)).toThrow(/1 to 120/);
    expect(() => checkProject("ok", { hello: 1 })).toThrow(/not a ledger export/i);
    expect(() => checkProject("ok", { ...file, note: "write to someone@example.com" })).toThrow(/email address/);
    expect(() => checkProject("ok", { ...file, pad: "x".repeat(10_000_001) })).toThrow(/over 10 MB/);
  });
  it("sends nothing when the check fails", async () => {
    const { api, calls } = fakeApi();
    await expect(saveCurrent(api, "w1", "ok", { nope: true })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it("refuses to hand back a saved file that is not a valid export", async () => {
    const { api, rows } = fakeApi();
    rows.set("bad", { row: { id: "id-bad", name: "bad", updated_at: "" }, file: { schema_version: 999 } });
    await expect(loadChecked(api, "id-bad")).rejects.toThrow(/schema version/);
  });
});

describe("delete all my cloud projects", () => {
  it("deletes every project and reports how many", async () => {
    const file = await realExport();
    const { api, rows } = fakeApi();
    await saveCurrent(api, "w1", "a", file);
    await saveCurrent(api, "w1", "b", file);
    expect(await deleteAllProjects(api, "w1")).toBe(2);
    expect(rows.size).toBe(0);
    expect(await deleteAllProjects(api, "w1")).toBe(0);
  });
});
