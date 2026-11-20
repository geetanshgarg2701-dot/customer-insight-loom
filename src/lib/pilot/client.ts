import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertProjectOrigin } from "./config";
import { PILOT } from "./enabled";
import { PilotError, type PilotApi, type ProjectRow } from "./service";

/**
 * The one file that talks to the pilot project, approved on 2026-11-20 as a narrow exception to the no network rule.
 * Pilot accounts are off unless the build had NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (a publishable
 * key). Every request goes through a function that refuses any other origin. The sign in is held in memory for this tab
 * only: nothing is written to browser storage or cookies, and a reload signs the person out.
 */
function sameOriginOnly(origin: string): typeof globalThis.fetch {
  return (input, init) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assertProjectOrigin(target, origin);
    return globalThis.fetch(input, init);
  };
}

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!PILOT) throw new PilotError("Pilot accounts are not turned on in this build.");
  client ??= createClient(PILOT.url, PILOT.key, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: sameOriginOnly(PILOT.origin) },
  });
  return client;
}

function ok<R extends { data: unknown; error: { message: string } | null }>(r: R): R["data"] {
  if (r.error) throw new PilotError(r.error.message);
  return r.data;
}

export const pilotApi: PilotApi = {
  async signUp(email, password) {
    const data = ok(await db().auth.signUp({ email, password }));
    return { needsConfirmation: !data.session };
  },
  async signIn(email, password) {
    ok(await db().auth.signInWithPassword({ email, password }));
  },
  async signOut() {
    await db().auth.signOut();
  },
  async findWorkspace() {
    const rows = ok(await db().from("workspaces").select("id").limit(1));
    return (rows as { id: string }[])[0]?.id ?? null;
  },
  async createWorkspace(name) {
    return ok(await db().rpc("create_workspace", { workspace_name: name })) as string;
  },
  async listProjects(workspaceId) {
    const rows = ok(
      await db().from("saved_projects").select("id,name,updated_at").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    );
    return rows as ProjectRow[];
  },
  async saveProject(workspaceId, name, file) {
    // Not an upsert: an upsert runs the insert trigger first, so saving over an existing project at the 20 project limit
    // would be refused. Look the name up, then update it or insert a new one.
    const found = ok(await db().from("saved_projects").select("id").eq("workspace_id", workspaceId).eq("name", name).limit(1)) as { id: string }[];
    if (found[0]) ok(await db().from("saved_projects").update({ file }).eq("id", found[0].id));
    else ok(await db().from("saved_projects").insert({ workspace_id: workspaceId, name, file }));
  },
  async loadProject(id) {
    return (ok(await db().from("saved_projects").select("file").eq("id", id).single()) as { file: unknown }).file;
  },
  async deleteProject(id) {
    ok(await db().from("saved_projects").delete().eq("id", id));
  },
};
