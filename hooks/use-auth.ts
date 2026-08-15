import { useAuth as useClerkAuth } from "@clerk/expo";
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * App-level auth hook. Wraps Clerk's session state (is the visitor signed
 * in?) with our local `users` row (app-specific fields like role/displayName),
 * synced server-side on first sight by `createContext` in
 * server/_core/context.ts.
 */
export function useAuth() {
  const { isLoaded, isSignedIn, signOut } = useClerkAuth();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: isLoaded && isSignedIn === true,
  });

  const user = isSignedIn ? (meQuery.data ?? null) : null;
  const loading = !isLoaded || (isSignedIn === true && meQuery.isLoading);
  const isAuthenticated = Boolean(isSignedIn && user);

  const logout = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return {
    user,
    loading,
    error: meQuery.error ?? null,
    isAuthenticated,
    refresh: meQuery.refetch,
    logout,
  };
}
