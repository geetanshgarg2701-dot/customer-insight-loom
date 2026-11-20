import { pilotConfig, type PilotConfig } from "./config";

/**
 * Read at build time from NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (a publishable key). Null in the
 * public build, which is made without them. This file holds no network code, so any screen can read it cheaply.
 */
export const PILOT: PilotConfig | null = pilotConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
