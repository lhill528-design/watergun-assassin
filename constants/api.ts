/**
 * Base URL of the tRPC backend (the Railway-hosted Express server).
 * Set via EXPO_PUBLIC_API_BASE_URL — same value used for local dev
 * (e.g. http://localhost:3000), EAS native builds, and the Vercel web build.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  return configured.replace(/\/$/, "");
}
