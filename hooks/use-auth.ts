import { useAuth as useClerkAuth } from "@clerk/expo";
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { deriveAuthStatus } from "@/hooks/auth-status";

/**
 * App-level auth hook. Wraps Clerk's session state (is the visitor signed
 * in?) with our local `users` row (app-specific fields like role/displayName),
 * synced server-side on first sight by `createContext` in
 * server/_core/context.ts.
 *
 * Exposes `status` so callers can tell "signed out" apart from "Clerk says
 * signed in but the backend user fetch is still in flight" (provisioning)
 * or "...and it failed" (backend-error) -- see hooks/auth-status.ts. The
 * older isAuthenticated/loading/error fields stay for existing call sites,
 * now derived from the same status instead of separately (and, previously,
 * incorrectly) computed.
 */
export function useAuth() {
  const { isLoaded, isSignedIn, signOut } = useClerkAuth();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: isLoaded && isSignedIn === true,
  });

  const status = deriveAuthStatus({
    clerkLoaded: isLoaded,
    isSignedIn,
    userQueryStatus: meQuery.status,
    hasUser: Boolean(meQuery.data),
  });

  const user = status.kind === "signed-in" ? (meQuery.data ?? null) : null;

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return {
    user,
    status,
    loading: status.kind === "loading" || status.kind === "provisioning",
    error: meQuery.error ?? null,
    isAuthenticated: status.kind === "signed-in",
    refresh: meQuery.refetch,
    logout,
  };
}
