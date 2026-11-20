"use client";

import Link from "next/link";
import { useState } from "react";
import { downloadText } from "@/lib/app/download";
import { getBrowserLedger, importBrowserLedger } from "@/lib/duckdb/client";
import { pilotApi } from "@/lib/pilot/client";
import { PILOT } from "@/lib/pilot/enabled";
import {
  MIN_PASSWORD,
  deleteAllProjects,
  loadChecked,
  login,
  register,
  saveCurrent,
  type ProjectRow,
} from "@/lib/pilot/service";
import { Nav } from "../nav";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function AccountPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(ws: string) {
    setProjects(await pilotApi.listProjects(ws));
  }

  if (!PILOT) {
    return (
      <main>
        <Nav />
        <h1>Pilot account</h1>
        <p>Pilot accounts are not turned on in this version of the app. Everything stays in this tab, and nothing is sent anywhere.</p>
      </main>
    );
  }

  const onSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await register(pilotApi, email, password);
      setNotice(r.needsConfirmation ? "Account made. Check your email for the confirmation link, then sign in." : "Account made. You can sign in now.");
    });
  };

  const onSignIn = () =>
    void run(async () => {
      const ws = await login(pilotApi, email, password);
      setPassword("");
      setWorkspace(ws);
      await refresh(ws);
    });

  const onSignOut = () =>
    void run(async () => {
      await pilotApi.signOut();
      setWorkspace(null);
      setProjects(null);
      setNotice("Signed out. Nothing from your account is kept in this tab.");
    });

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    void run(async () => {
      const file = await (await getBrowserLedger()).exportFile();
      await saveCurrent(pilotApi, workspace, name, file);
      await refresh(workspace);
      setNotice(`Saved "${name.trim()}".`);
    });
  };

  const onLoad = (p: ProjectRow) =>
    void run(async () => {
      const file = await loadChecked(pilotApi, p.id);
      await importBrowserLedger(file);
      setNotice(`Loaded "${p.name}" into the ledger. Open the Ledger screen to see it.`);
    });

  const onDownload = (p: ProjectRow) =>
    void run(async () => {
      const file = await loadChecked(pilotApi, p.id);
      downloadText(`${p.name}.json`, "application/json", JSON.stringify(file, null, 2));
    });

  const onDeleteOne = (p: ProjectRow) =>
    void run(async () => {
      if (!workspace) return;
      await pilotApi.deleteProject(p.id);
      await refresh(workspace);
      setNotice(`Deleted "${p.name}" from your account.`);
    });

  const onDeleteAll = () =>
    void run(async () => {
      if (!workspace) return;
      const n = await deleteAllProjects(pilotApi, workspace);
      await refresh(workspace);
      setTyped("");
      setNotice(`Deleted ${n} saved ${n === 1 ? "project" : "projects"} from your account.`);
    });

  return (
    <main>
      <Nav />
      <h1>Pilot account</h1>
      <p>
        An account lets you keep ledger files in the cloud between visits. It is a pilot, on a test service. Only the ledger
        export file is saved: entries, results and customer hashes, never an email address or a customer file. Everything else
        stays in this tab. See <Link href="/privacy">Privacy</Link>.
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}

      {!workspace ? (
        <section aria-labelledby="h-signin">
          <h2 id="h-signin">Sign in or make an account</h2>
          <form onSubmit={onSignUp}>
            <p>
              <label>
                Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
              </label>
            </p>
            <p>
              <label>
                Password, at least {MIN_PASSWORD} characters{" "}
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </label>
            </p>
            <p>
              <button type="button" disabled={busy} onClick={onSignIn}>
                Sign in
              </button>{" "}
              <button type="submit" disabled={busy}>
                Make an account
              </button>
            </p>
          </form>
          <p>You stay signed in for this tab only. Reloading the page signs you out.</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="h-save">
            <h2 id="h-save">Save the ledger</h2>
            <form onSubmit={onSave}>
              <p>
                <label>
                  Project name <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </label>
              </p>
              <button type="submit" disabled={busy}>
                Save the ledger to my account
              </button>
              <p>Saving under a name you already used replaces that project. You can keep up to 10 projects, each up to 10 MB.</p>
            </form>
          </section>

          <section aria-labelledby="h-projects">
            <h2 id="h-projects">Saved projects</h2>
            {projects && projects.length === 0 && <p>No saved projects yet.</p>}
            {projects && projects.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table aria-label="Saved projects">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Last saved</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id}>
                        <th scope="row">{p.name}</th>
                        <td>{p.updated_at.slice(0, 19).replace("T", " ")} UTC</td>
                        <td>
                          <button type="button" disabled={busy} aria-label={`Load ${p.name} into the ledger`} onClick={() => onLoad(p)}>
                            Load
                          </button>{" "}
                          <button type="button" disabled={busy} aria-label={`Download ${p.name}`} onClick={() => onDownload(p)}>
                            Download
                          </button>{" "}
                          <button type="button" disabled={busy} aria-label={`Delete ${p.name}`} onClick={() => onDeleteOne(p)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p>Loading needs an empty ledger. Reload the page first if the ledger already has entries.</p>
          </section>

          <section aria-labelledby="h-delete">
            <h2 id="h-delete">Delete my saved projects</h2>
            <p>
              Deletes every saved project in your account. It cannot be undone. This does not delete the account itself, which
              the pilot organiser removes on request, and it does not touch this tab or files you downloaded.
            </p>
            <p>
              <label>
                Type delete to confirm <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            </p>
            <p>
              <button type="button" disabled={busy || typed.trim().toLowerCase() !== "delete"} onClick={onDeleteAll}>
                Delete all my saved projects
              </button>
            </p>
          </section>

          <p>
            <button type="button" disabled={busy} onClick={onSignOut}>
              Sign out
            </button>
          </p>
        </>
      )}
    </main>
  );
}
