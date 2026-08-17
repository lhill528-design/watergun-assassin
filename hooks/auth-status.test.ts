import { describe, expect, it } from "vitest";
import { deriveAuthStatus } from "./auth-status";

describe("deriveAuthStatus", () => {
  it("is loading before Clerk has loaded, regardless of query state", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: false,
        isSignedIn: undefined,
        sessionActivationPending: false,
        userQueryStatus: "pending",
        hasUser: false,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("is signed-out once Clerk has loaded and reports no session", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: false,
        sessionActivationPending: false,
        userQueryStatus: "pending",
        hasUser: false,
      }),
    ).toEqual({ kind: "signed-out" });
  });

  it("is provisioning while Clerk reports signed-in but the backend user query is still pending", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: true,
        sessionActivationPending: false,
        userQueryStatus: "pending",
        hasUser: false,
      }),
    ).toEqual({ kind: "provisioning" });
  });

  // The core scenario this module exists to fix: Clerk confirms a session,
  // but the backend user fetch failed. Previously indistinguishable from
  // signed-out, which sent an already-authenticated visitor back to the
  // sign-in form (and a retry there failed with "session already exists").
  it("is backend-error when Clerk reports signed-in but the user query errored -- distinct from signed-out", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: true,
        sessionActivationPending: false,
        userQueryStatus: "error",
        hasUser: false,
      }),
    ).toEqual({ kind: "backend-error" });
  });

  it("is provisioning if the query somehow succeeds with no user data yet", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: true,
        sessionActivationPending: false,
        userQueryStatus: "success",
        hasUser: false,
      }),
    ).toEqual({ kind: "provisioning" });
  });

  it("is signed-in once Clerk confirms a session and the user row has resolved", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: true,
        sessionActivationPending: false,
        userQueryStatus: "success",
        hasUser: true,
      }),
    ).toEqual({ kind: "signed-in" });
  });

  // The specific, narrowly-scoped fix for the production bug: a successful,
  // populated auth.me response only bridges the gap while
  // sessionActivationPending is true (set by SignInForm right after a real
  // setActive() call) -- not just because the cache happens to hold data.
  it("is signed-in on a successful populated response while session activation is pending", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: false,
        sessionActivationPending: true,
        userQueryStatus: "success",
        hasUser: true,
      }),
    ).toEqual({ kind: "signed-in" });
  });

  // The regression this correction exists to fix: without an active pending
  // window, an explicit isSignedIn === false must win even over a stale
  // cached user -- covers both logout (which clears the cache, but this
  // must hold even if it didn't) and session expiry (Clerk flips
  // isSignedIn on its own; nothing clears the cache at all).
  it("is signed-out on stale cached user data when isSignedIn is false and nothing is pending", () => {
    expect(
      deriveAuthStatus({
        clerkLoaded: true,
        isSignedIn: false,
        sessionActivationPending: false,
        userQueryStatus: "success",
        hasUser: true,
      }),
    ).toEqual({ kind: "signed-out" });
  });
});
