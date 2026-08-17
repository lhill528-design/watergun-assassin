import { useAuth as useClerkAuth } from "@clerk/expo";
import { useCallback, useEffect } from "react";
import { useQuery as useReactQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { deriveAuthStatus } from "@/hooks/auth-status";

// Shared (not per-hook-instance) state: "idle" outside of any bridge
// window, "pending" only in the narrow window between a fresh setActive()
// call and Clerk's own isSignedIn catching up with it, "expired" once that
// window's bounded timer has run out without isSignedIn ever catching up.
// Stored in the same react-query cache auth.me itself lives in, so every
// mounted useAuth() call across every screen observes the same value
// reactively -- the same mechanism that already lets a forced auth.me
// refetch propagate to every observer of that query key regardless of each
// observer's own `enabled`. See deriveAuthStatus in ./auth-status for
// exactly how (and how narrowly) this is used: "pending" only ever unlocks
// "signed-in" together with an independently-verified successful auth.me
// response, never on its own, and "expired" refuses to unlock it at all.
const SESSION_ACTIVATION_STATE_KEY = ["auth", "sessionActivationState"] as const;
type SessionActivationState = "idle" | "pending" | "expired";

// How long the bridge waits for Clerk's modern isSignedIn to catch up with
// a setActive() call before giving up. Bounded so a Clerk client that never
// (rather than just slowly) reflects the new session can't leave the app
// showing a signed-in view, backed only by a cached auth.me response,
// forever.
export const SESSION_ACTIVATION_TIMEOUT_MS = 15_000;

// Module-level (not per-hook-instance), matching SESSION_ACTIVATION_STATE_KEY
// above: there is only ever one bridge window open app-wide at a time, so
// its timer handle lives alongside it rather than in any one component's
// state. Guarded by clearSessionActivationTimer() at every entry/exit point
// (a fresh confirmSessionActivated() call, isSignedIn catching up, the
// forced auth.me request failing, expiry itself firing, and logout) so a
// stale handle never fires against a bridge window that's already closed.
let sessionActivationTimer: ReturnType<typeof setTimeout> | null = null;

function clearSessionActivationTimer() {
  if (sessionActivationTimer !== null) {
    clearTimeout(sessionActivationTimer);
    sessionActivationTimer = null;
  }
}

function armSessionActivationTimer(queryClient: QueryClient) {
  clearSessionActivationTimer();
  sessionActivationTimer = setTimeout(() => {
    sessionActivationTimer = null;
    // A cache write (not a plain timestamp check) so expiry is reactive:
    // every mounted useAuth() re-renders via its subscription to this same
    // query key, the same way a forced auth.me refetch already propagates
    // to every observer regardless of that observer's own `enabled`.
    queryClient.setQueryData(SESSION_ACTIVATION_STATE_KEY, "expired" satisfies SessionActivationState);
  }, SESSION_ACTIVATION_TIMEOUT_MS);
}

/**
 * App-level auth hook. Wraps Clerk's session state (is the visitor signed
 * in?) with our local `users` row (app-specific fields like role/displayName),
 * synced server-side on first sight by `createContext` in
 * server/_core/context.ts.
 *
 * Exposes `status` so callers can tell "signed out" apart from "Clerk says
 * signed in but the backend user fetch is still in flight" (provisioning),
 * "...and it failed" (backend-error), or "we bridged the gap after
 * setActive() but Clerk's isSignedIn never caught up before the bridge's
 * bounded window ran out" (sync-expired) -- see hooks/auth-status.ts. The
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

  const stateQuery = useReactQuery({
    queryKey: SESSION_ACTIVATION_STATE_KEY,
    queryFn: () => "idle" as SessionActivationState,
    initialData: "idle" as SessionActivationState,
    staleTime: Infinity,
  });
  const sessionActivationState = stateQuery.data ?? "idle";

  // Clerk caught up on its own -- the bridge isn't needed anymore, whether
  // it caught up before the bounded window ran out ("pending") or only
  // after ("expired"). Normalizing "expired" back to "idle" here too
  // matters: isSignedIn is now authoritatively true, so deriveAuthStatus
  // will already fall through to the normal signed-in-branch rules -- but
  // leaving "expired" sitting in the cache would surface a stale
  // sync-expired screen the next time isSignedIn genuinely goes false
  // (e.g. a later, real session expiry), instead of the correct
  // signed-out. An effect (not a render-time write) so this doesn't run as
  // a render side effect.
  useEffect(() => {
    if (isSignedIn && sessionActivationState !== "idle") {
      clearSessionActivationTimer();
      queryClient.setQueryData(SESSION_ACTIVATION_STATE_KEY, "idle" satisfies SessionActivationState);
    }
  }, [isSignedIn, sessionActivationState, queryClient]);

  const status = deriveAuthStatus({
    clerkLoaded: isLoaded,
    isSignedIn,
    sessionActivationState,
    userQueryStatus: meQuery.status,
    hasUser: Boolean(meQuery.data),
  });

  const user = status.kind === "signed-in" ? (meQuery.data ?? null) : null;

  // Called by SignInForm right after a real setActive() succeeds, or after
  // Clerk reports a session already exists on retry -- and also offered as
  // the Retry action from the sync-expired state, to re-open the bridge
  // manually without routing back through the sign-in form. Opens the
  // bridge window with a bounded timer (armSessionActivationTimer), then
  // forces auth.me to fetch via the query's own observer-level refetch() --
  // NOT trpc.useUtils().auth.me.refetch(), which (per @trpc/react-query's
  // implementation, itself calling queryClient.refetchQueries()) skips
  // currently-disabled queries and would silently do nothing here, the
  // same flaw invalidate() had.
  const confirmSessionActivated = useCallback(async () => {
    queryClient.setQueryData(SESSION_ACTIVATION_STATE_KEY, "pending" satisfies SessionActivationState);
    armSessionActivationTimer(queryClient);
    const result = await meQuery.refetch();
    if (result.status === "error") {
      // The forced fetch itself failed. setActive() already succeeded
      // though -- Clerk itself believes a session was created -- so this
      // must NOT fall back to "idle": deriveAuthStatus would then read
      // isSignedIn===false with nothing pending and render the sign-in
      // form again, and retrying there risks the exact session_exists loop
      // the bridge exists to avoid. Go straight to "expired" instead, the
      // same explicit synchronization-error state a timeout reaches, which
      // offers Retry/Sign Out rather than the sign-in form.
      clearSessionActivationTimer();
      queryClient.setQueryData(SESSION_ACTIVATION_STATE_KEY, "expired" satisfies SessionActivationState);
    }
  }, [queryClient, meQuery.refetch]);

  const logout = useCallback(async () => {
    await signOut();
    // Never let a stale pending/expired flag or a stale cached user outlive
    // an explicit sign-out. deriveAuthStatus already refuses cached data
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
    clearSessionActivationTimer();
    queryClient.setQueryData(SESSION_ACTIVATION_STATE_KEY, "idle" satisfies SessionActivationState);
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
