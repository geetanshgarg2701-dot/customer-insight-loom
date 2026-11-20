/**
 * Pilot accounts are off unless the build was given a Supabase project address and a publishable key. The public site
 * is built without them, so it has no sign in and sends nothing. The address must be https, with no path, so the one
 * origin the app may talk to is unambiguous.
 */
export type PilotConfig = { url: string; origin: string; key: string };

export function pilotConfig(url: string | undefined, key: string | undefined): PilotConfig | null {
  if (!url || !key) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  // A secret key must never reach the browser. The service role and secret keys are refused outright.
  if (/^sb_secret_/.test(key) || isServiceRoleJwt(key)) return null;
  return { url: parsed.origin, origin: parsed.origin, key };
}

function isServiceRoleJwt(key: string): boolean {
  const part = key.split(".")[1];
  if (!part) return false;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
    return json.role === "service_role";
  } catch {
    return false;
  }
}

/** Throws unless the request goes to the pilot project's own origin. */
export function assertProjectOrigin(target: string, origin: string): void {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    throw new Error(`Blocked request to ${target}: not an address.`);
  }
  if (u.origin !== origin) throw new Error(`Blocked request to ${u.origin}: pilot accounts may only reach ${origin}.`);
}
