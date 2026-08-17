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
  | { kind: "signed-in" };

export function deriveAuthStatus(input: {
  clerkLoaded: boolean;
  isSignedIn: boolean | undefined;
  // True only in the narrow window between a successful setActive() call
  // (see hooks/use-auth.ts's confirmSessionActivated) and Clerk's own
  // isSignedIn flag catching up to it -- set by SignInForm right after OTP
  // verification succeeds, and cleared as soon as isSignedIn actually
  // becomes true, or on logout. It is NEVER set just because auth.me's
  // cache happens to hold a successful response; a stale cached user does
  // not, on its own, make this true.
  sessionActivationPending: boolean;
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
    if (input.sessionActivationPending && input.userQueryStatus === "success" && input.hasUser) {
      // Bridges only the gap right after a real setActive() call, backed
      // by independent, server-verified proof (a successful, populated
      // auth.me response necessarily required a valid bearer token) --
      // not by isSignedIn's propagation timing across the legacy/modern
      // Clerk hook boundary.
      return { kind: "signed-in" };
    }
    return { kind: "signed-out" };
  }

  if (input.userQueryStatus === "error") return { kind: "backend-error" };
  if (input.userQueryStatus === "success" && input.hasUser) return { kind: "signed-in" };
  return { kind: "provisioning" };
}
