// Pure state-machine for combining Clerk's session state with our own
// backend's user-provisioning query. Kept dependency-free so it's directly
// unit-testable without mocking Clerk or react-query.
//
// The bug this exists to prevent: useAuth() previously computed
// `isAuthenticated = Boolean(isSignedIn && user)`, where `user` came from
// the auth.me query. If that query ever errored (a transient network blip,
// the backend being briefly unreachable, etc.), `user` stayed null forever
// -- indistinguishable from "never signed in" -- so a fully Clerk-authenticated
// visitor got shown the sign-in form again with no explanation, and retrying
// sign-in produced a confusing "session already exists" error, since Clerk
// already considered them signed in.
export type AuthStatus =
  | { kind: "loading" }
  | { kind: "signed-out" }
  // Clerk confirms a session, but our backend's user row hasn't resolved yet
  // (query in flight, or hasn't been enabled/refetched yet).
  | { kind: "provisioning" }
  // Clerk confirms a session, but fetching/provisioning the local user row
  // failed. Distinct from "signed-out" -- the fix is Retry or Sign Out, not
  // showing the sign-in form again.
  | { kind: "backend-error" }
  // The post-setActive() bridge (see hooks/use-auth.ts) ran out its bounded
  // window without Clerk's own isSignedIn ever catching up. Distinct from
  // "signed-out": showing the sign-in form again here risks the same
  // "session already exists" loop the bridge exists to avoid, if Clerk's
  // client-side flag is simply lagging rather than genuinely signed out. The
  // fix offered is a manual Retry (re-open the bridge) or an explicit Sign
  // Out (which actually ends the Clerk session, so a fresh sign-in won't
  // hit session_exists either).
  | { kind: "sync-expired" }
  | { kind: "signed-in" };

export function deriveAuthStatus(input: {
  clerkLoaded: boolean;
  isSignedIn: boolean | undefined;
  // "idle" outside of any bridge window. "pending" only in the narrow
  // window between a successful setActive() call (see hooks/use-auth.ts's
  // confirmSessionActivated) and Clerk's own isSignedIn flag catching up to
  // it -- set by SignInForm right after OTP verification succeeds, and
  // cleared as soon as isSignedIn actually becomes true, or on logout.
  // "expired" once that window's bounded timer has run out without
  // isSignedIn ever catching up. A stale cache is NEVER, on its own, enough
  // to reach "signed-in" -- only "pending" (with an independently-verified
  // successful auth.me response) does that; "expired" explicitly refuses
  // to, even with the same cached response still sitting there.
  sessionActivationState: "idle" | "pending" | "expired";
  userQueryStatus: "pending" | "error" | "success";
  hasUser: boolean;
}): AuthStatus {
  if (!input.clerkLoaded) return { kind: "loading" };

  if (!input.isSignedIn) {
    // Once Clerk is loaded and explicitly reports no session, that's
    // authoritative -- covers logout and session expiry, including
    // whenever auth.me's cache still holds a previous user (logout is
    // responsible for clearing that cache, but this check doesn't depend
    // on that alone: it never trusts cached data here except inside the
    // narrow, explicitly-managed pending window below).
    if (input.sessionActivationState === "pending" && input.userQueryStatus === "success" && input.hasUser) {
      // Bridges only the gap right after a real setActive() call, backed
      // by independent, server-verified proof (a successful, populated
      // auth.me response necessarily required a valid bearer token) --
      // not by isSignedIn's propagation timing across the legacy/modern
      // Clerk hook boundary.
      return { kind: "signed-in" };
    }
    if (input.sessionActivationState === "expired") {
      // The bridge's bounded window ran out and isSignedIn still never
      // flipped. Do NOT fall through to signed-out here even though the
      // cache may still hold the same successful response that qualified
      // above a moment ago -- that's exactly the "stale cache overrides an
      // authoritative isSignedIn===false" bug this module exists to
      // prevent, just reached via a different path (timeout instead of
      // logout/expiry).
      return { kind: "sync-expired" };
    }
    return { kind: "signed-out" };
  }

  if (input.userQueryStatus === "error") return { kind: "backend-error" };
  if (input.userQueryStatus === "success" && input.hasUser) return { kind: "signed-in" };
  return { kind: "provisioning" };
}
