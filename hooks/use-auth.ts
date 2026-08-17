import { useAuth as useClerkAuth } from "@clerk/expo";
import { useCallback, useEffect } from "react";
import { useQuery as useReactQuery, useQueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { deriveAuthStatus } from "@/hooks/auth-status";

// Shared (not per-hook-instance) flag: true only in the narrow window
// between a fresh setActive() call and Clerk's own isSignedIn catching up
// with it. Stored in the same react-query cache auth.me itself lives in,
// so every mounted useAuth() call across every screen observes the same
// value reactively -- the same mechanism that already lets a forced
// auth.me refetch propagate to every observer of that query key
// regardless of each observer's own `enabled`. See deriveAuthStatus in
// ./auth-status for exactly how (and how narrowly) this is used: it only
// ever unlocks "signed-in" together with an independently-verified
// successful auth.me response, never on its own.
const SESSION_ACTIVATION_PENDING_KEY = ["auth", "sessionActivationPending"] as const;

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
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: isLoaded && isSignedIn === true,
  });

  const pendingQuery = useReactQuery({
    queryKey: SESSION_ACTIVATION_PENDING_KEY,
    queryFn: () => false,
    initialData: false,
    staleTime: Infinity,
  });
  const sessionActivationPending = pendingQuery.data === true;

  // Clerk caught up on its own -- the bridge isn't needed anymore. An
  // effect (not a render-time write) so this doesn't run as a render side
  // effect.
  useEffect(() => {
    if (isSignedIn && sessionActivationPending) {
      queryClient.setQueryData(SESSION_ACTIVATION_PENDING_KEY, false);
    }
  }, [isSignedIn, sessionActivationPending, queryClient]);

  const status = deriveAuthStatus({
    clerkLoaded: isLoaded,
    isSignedIn,
    sessionActivationPending,
    userQueryStatus: meQuery.status,
    hasUser: Boolean(meQuery.data),
  });

  const user = status.kind === "signed-in" ? (meQuery.data ?? null) : null;

  // Called by SignInForm right after a real setActive() succeeds, or after
  // Clerk reports a session already exists on retry. Opens the bridge
  // window, then forces auth.me to fetch via the query's own
  // observer-level refetch() -- NOT trpc.useUtils().auth.me.refetch(),
  // which (per @trpc/react-query's implementation, itself calling
  // queryClient.refetchQueries()) skips currently-disabled queries and
  // would silently do nothing here, the same flaw invalidate() had.
  const confirmSessionActivated = useCallback(async () => {
    queryClient.setQueryData(SESSION_ACTIVATION_PENDING_KEY, true);
    await meQuery.refetch();
  }, [queryClient, meQuery.refetch]);

  const logout = useCallback(async () => {
    await signOut();
    // Never let a stale pending flag or a stale cached user outlive an
    // explicit sign-out. deriveAuthStatus already refuses cached data
    // once isSignedIn is false with nothing pending, but clearing both
    // here too removes any window where a lingering value could matter.
    //
    // setData (not reset()/removeQueries with an active refetch) is
    // deliberate: at this exact point React hasn't necessarily re-rendered
    // with the just-updated isSignedIn yet, so auth.me's query observer
    // may still be registered with its previous `enabled: true`. reset()
    // internally refetches any still-"active" query afterward, which in
    // that narrow window immediately re-fetches and undoes the clear.
    // setData writes the cache directly with no fetch involved, so there's
    // nothing for that race to interfere with.
    queryClient.setQueryData(SESSION_ACTIVATION_PENDING_KEY, false);
    utils.auth.me.setData(undefined, null);
  }, [signOut, queryClient, utils]);

  return {
    user,
    status,
    loading: status.kind === "loading" || status.kind === "provisioning",
    error: meQuery.error ?? null,
    isAuthenticated: status.kind === "signed-in",
    refresh: meQuery.refetch,
    confirmSessionActivated,
    logout,
  };
}
