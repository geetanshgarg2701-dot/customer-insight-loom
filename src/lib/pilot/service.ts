import { validateExport } from "../ledger/export";

/** What the app needs from the cloud, so the logic below can be tested with no network. */
export interface PilotApi {
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** The signed in person's workspace id, or null if they have none. */
  findWorkspace(): Promise<string | null>;
  createWorkspace(name: string): Promise<string>;
  listProjects(workspaceId: string): Promise<ProjectRow[]>;
  saveProject(workspaceId: string, name: string, file: unknown): Promise<void>;
  loadProject(id: string): Promise<unknown>;
  deleteProject(id: string): Promise<void>;
}

export type ProjectRow = { id: string; name: string; updated_at: string };

export const MAX_FILE_BYTES = 10_000_000;
export const MAX_NAME = 120;
export const MIN_PASSWORD = 12;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class PilotError extends Error {}

export function checkCredentials(email: string, password: string): void {
  if (!EMAIL_ADDRESS.test(email.trim())) throw new PilotError("Enter a valid email address.");
  if (password.length < MIN_PASSWORD) throw new PilotError(`The password must be at least ${MIN_PASSWORD} characters.`);
}

/** Every rule the database also enforces, checked first so the person gets a plain message and nothing invalid is sent. */
export function checkProject(name: string, file: unknown): { name: string; file: unknown } {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME) throw new PilotError(`The project name must be 1 to ${MAX_NAME} characters.`);
  validateExport(file);
  const text = JSON.stringify(file);
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new PilotError("The ledger file is over 10 MB, the most a saved project can hold.");
  if (EMAIL.test(text)) throw new PilotError("The ledger file holds something shaped like an email address, so it was not saved. The ledger should hold hashes only.");
  return { name: trimmed, file };
}

export async function register(api: PilotApi, email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  checkCredentials(email, password);
  return api.signUp(email.trim(), password);
}

/** Signs in and returns the workspace id, making a workspace on the first sign in. */
export async function login(api: PilotApi, email: string, password: string): Promise<string> {
  checkCredentials(email, password);
  await api.signIn(email.trim(), password);
  return (await api.findWorkspace()) ?? api.createWorkspace("My workspace");
}

export async function saveCurrent(api: PilotApi, workspaceId: string, name: string, file: unknown): Promise<void> {
  const ok = checkProject(name, file);
  await api.saveProject(workspaceId, ok.name, ok.file);
}

/** Reads a saved project and checks it as an import would, so a bad file is refused before it touches the ledger. */
export async function loadChecked(api: PilotApi, id: string): Promise<unknown> {
  const file = await api.loadProject(id);
  validateExport(file);
  return file;
}

/** Deletes every saved project in the workspace. Returns how many. */
export async function deleteAllProjects(api: PilotApi, workspaceId: string): Promise<number> {
  const rows = await api.listProjects(workspaceId);
  for (const r of rows) await api.deleteProject(r.id);
  return rows.length;
}
