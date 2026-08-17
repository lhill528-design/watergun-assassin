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
  userQueryStatus: "pending" | "error" | "success";
  hasUser: boolean;
}): AuthStatus {
  // A successful, populated backend response is authoritative on its own --
  // it could only happen with a valid bearer token, so it's trusted even if
  // Clerk's client-side isSignedIn flag (read via a *different* hook,
  // @clerk/expo's useAuth) hasn't reflected the same session change yet.
  // This is what lets SignInForm force an auth.me refetch right after
  // setActive() and transition the UI immediately, without depending on
  // isSignedIn's propagation timing across that hook boundary -- the
  // react-query cache updates for every observer of the same query key
  // regardless of each observer's own `enabled` value, so this stays
  // correct even if isSignedIn is slow (or, in the pathological case,
  // never updates at all).
  if (input.userQueryStatus === "success" && input.hasUser) return { kind: "signed-in" };
  if (!input.clerkLoaded) return { kind: "loading" };
  if (!input.isSignedIn) return { kind: "signed-out" };
  if (input.userQueryStatus === "error") return { kind: "backend-error" };
  return { kind: "provisioning" };
}
