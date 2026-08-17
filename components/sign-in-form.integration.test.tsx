// @vitest-environment jsdom
//
// Real-render integration test proving the actual bug and fix from the
// production incident, plus the stale-cache-overrides-logout regression
// found in review of the first fix: does auth.me actually get fetched
// after OTP verify, does the app transition away from the sign-in form,
// and -- just as importantly -- does an explicit sign-out or session
// expiry ever get overridden by a stale cached user? Pure unit tests on
// the extracted helpers (sign-in-form-results.ts, auth-status.ts) can't
// prove any of this -- they never mount SignInForm and useAuth together,
// so they can't catch a wiring bug between them.
//
// react-native primitives (View/Text/TextInput/TouchableOpacity) are
// stubbed to their plain DOM equivalents -- this project's real web build
// gets that translation from react-native-web via Metro, which vitest
// doesn't do, and it's not what's under test here anyway. What IS real
// and unmocked: useAuth, SignInForm, deriveAuthStatus, and a genuine
// @tanstack/react-query QueryClient providing the enabled-gating and
// refetch semantics that were the actual bug. Clerk's isSignedIn is
// mocked but reactive (via useSyncExternalStore), so the tests can flip
// it independently of setActive() -- exactly what's needed to prove the
// pending-bridge window is narrowly scoped rather than a blanket
// cache-wins-over-Clerk rule.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";

// Not auto-registered: this file imports vitest's test API explicitly
// rather than relying on vitest.config.ts's `globals` (which isn't set),
// and @testing-library/react's cleanup auto-registration depends on
// detecting a global afterEach. Without this, each test's render() leaves
// its DOM tree mounted, and later tests see duplicate elements from every
// prior test in the same file.
afterEach(cleanup);

const clerkState = vi.hoisted(() => {
  let isSignedIn = false;
  const listeners = new Set<() => void>();
  return {
    get isSignedIn() {
      return isSignedIn;
    },
    setIsSignedIn(next: boolean) {
      isSignedIn = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("react-native", () => {
  const React = require("react");
  return {
    View: (props: any) => React.createElement("div", null, props.children),
    Text: (props: any) => React.createElement("span", null, props.children),
    TextInput: ({ value, onChangeText, placeholder, maxLength }: any) =>
      React.createElement("input", {
        "aria-label": placeholder,
        value,
        maxLength,
        onChange: (e: any) => onChangeText?.(e.target.value),
      }),
    TouchableOpacity: ({ onPress, disabled, children }: any) =>
      React.createElement("button", { onClick: onPress, disabled }, children),
    ActivityIndicator: () => React.createElement("span", null, "loading"),
  };
});

const mockSignInCreate = vi.fn();
const mockPrepareFirstFactor = vi.fn();
const mockAttemptFirstFactor = vi.fn();
// Simulates the real Clerk contract: setActive() is what actually flips
// the shared session state that useAuth() (a completely separate hook,
// from a different Clerk entry point) reads -- but each test controls
// independently whether this mock actually flips isSignedIn, since the
// whole point of the pending-bridge fix is that the UI must not depend on
// it doing so promptly.
const mockSetActiveSignIn = vi.fn();
const mockSignOut = vi.fn(async () => {
  clerkState.setIsSignedIn(false);
});

vi.mock("@clerk/expo/legacy", () => ({
  useSignIn: () => ({
    isLoaded: true,
    signIn: {
      create: mockSignInCreate,
      prepareFirstFactor: mockPrepareFirstFactor,
      attemptFirstFactor: mockAttemptFirstFactor,
    },
    setActive: mockSetActiveSignIn,
  }),
  useSignUp: () => ({
    isLoaded: true,
    signUp: {
      create: vi.fn(),
      prepareEmailAddressVerification: vi.fn(),
      attemptEmailAddressVerification: vi.fn(),
    },
    setActive: vi.fn(),
  }),
}));

vi.mock("@clerk/expo", () => {
  const React = require("react");
  return {
    useAuth: () => {
      const isSignedIn = React.useSyncExternalStore(clerkState.subscribe, () => clerkState.isSignedIn);
      return { isLoaded: true, isSignedIn, signOut: mockSignOut };
    },
  };
});

// Backed by a real QueryClient (via useQuery) so `enabled` gating and a
// query's own refetch() (which -- unlike trpc.useUtils().X.refetch() --
// does not skip disabled queries; see sign-in-form.tsx's onSessionActive
// doc comment) are exercised by the actual react-query engine, not
// reimplemented by hand. Only the "network" (queryFn) is faked, standing
// in for what would be a real tRPC request to the backend.
const AUTH_ME_KEY = ["auth", "me"] as const;
let authMeFetchCount = 0;
let backendUser: { id: number; role: string } | null = null;
// Lets tests simulate the forced auth.me request itself failing (a
// transient network blip right as confirmSessionActivated forces the
// refetch), independent of backendUser/isSignedIn -- see the "forced
// auth.me request fails" test below.
let authMeShouldFail = false;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: (_input: unknown, options: { enabled: boolean }) =>
          useQuery({
            queryKey: AUTH_ME_KEY,
            queryFn: async () => {
              authMeFetchCount += 1;
              if (authMeShouldFail) throw new Error("network error");
              return backendUser;
            },
            enabled: options.enabled,
            retry: false,
          }),
      },
    },
    useUtils: () => {
      const queryClient = useQueryClient();
      return {
        auth: {
          me: {
            reset: () => queryClient.resetQueries({ queryKey: AUTH_ME_KEY }),
            // Matches @trpc/react-query's real setData(input, updater):
            // the first arg is the procedure input (shifted off), the rest
            // forwarded to queryClient.setQueryData.
            setData: (_input: unknown, value: unknown) => queryClient.setQueryData(AUTH_ME_KEY, value),
          },
        },
      };
    },
  },
}));

// Imported after the mocks above so they pick up the mocked modules.
const { SignInForm } = await import("./sign-in-form");
const { useAuth, SESSION_ACTIVATION_TIMEOUT_MS } = await import("@/hooks/use-auth");

// Mirrors the actual wiring in app/(tabs)/index.tsx and profile.tsx:
// SignInForm gets useAuth()'s `confirmSessionActivated` (which opens the
// pending-bridge window before forcing a refetch), not `refresh` alone or
// trpc.useUtils().auth.me.refetch() (which silently no-ops against a
// disabled query, same flaw invalidate() had).
function TestHarness() {
  const { status, confirmSessionActivated, logout } = useAuth();
  if (status.kind === "signed-in") {
    return React.createElement(
      "div",
      null,
      React.createElement("span", null, "SIGNED IN"),
      React.createElement("button", { onClick: () => logout() }, "Log Out"),
    );
  }
  return React.createElement(SignInForm, { onSessionActive: confirmSessionActivated });
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(TestHarness)),
  );
  return { ...utils, queryClient };
}

async function requestAndEnterCode(user: ReturnType<typeof userEvent.setup>, email: string, code: string) {
  await user.type(screen.getByLabelText("you@example.com"), email);
  await user.click(screen.getByText("Sign In to Play"));
  await waitFor(() => expect(screen.getByLabelText("123456")).toBeTruthy());
  await user.type(screen.getByLabelText("123456"), code);
}

describe("SignInForm + useAuth integration", () => {
  it("issues auth.me and unmounts the sign-in form after OTP verify completes", async () => {
    clerkState.setIsSignedIn(false);
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup();

    mockSignInCreate.mockResolvedValue({
      supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }],
    });
    mockPrepareFirstFactor.mockResolvedValue({});
    mockAttemptFirstFactor.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });
    mockSetActiveSignIn.mockImplementation(async () => {
      clerkState.setIsSignedIn(true);
    });

    renderHarness();
    await requestAndEnterCode(user, "player@example.com", "123456");

    // Step 2: verify -- this is the exact click that did nothing in
    // production.
    await user.click(screen.getByText("Verify & Sign In"));

    // Proves setActive actually ran (the session-activation half of the
    // sequence).
    await waitFor(() => expect(mockSetActiveSignIn).toHaveBeenCalledWith({ session: "sess_1" }));

    // Proves auth.me was actually issued as a request after verification --
    // the exact thing DevTools showed zero of in production.
    await waitFor(() => expect(authMeFetchCount).toBeGreaterThan(0));

    // Proves the app transitioned: the sign-in form is gone, replaced by
    // the authenticated view.
    await waitFor(() => expect(screen.getByText("SIGNED IN")).toBeTruthy());
    expect(screen.queryByText("Verify & Sign In")).toBeNull();
  });

  // Isolates the pending-bridge mechanism from Clerk's own isSignedIn
  // propagation entirely: setActive() resolves, but this mock deliberately
  // never flips isSignedIn, simulating the exact "Clerk's client-side flag
  // never (or not promptly) reflects the new session" failure mode the
  // original bug report suspected. The UI must still transition, proving
  // the fix doesn't just get lucky when isSignedIn happens to update fast.
  it("transitions to signed-in via the pending window even while isSignedIn never flips", async () => {
    clerkState.setIsSignedIn(false);
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup();

    mockSignInCreate.mockResolvedValue({
      supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_2" }],
    });
    mockPrepareFirstFactor.mockResolvedValue({});
    mockAttemptFirstFactor.mockResolvedValue({ status: "complete", createdSessionId: "sess_2" });
    mockSetActiveSignIn.mockResolvedValue(undefined); // does NOT flip isSignedIn

    renderHarness();
    await requestAndEnterCode(user, "player2@example.com", "123456");
    await user.click(screen.getByText("Verify & Sign In"));

    expect(clerkState.isSignedIn).toBe(false); // confirms the isolation held
    await waitFor(() => expect(screen.getByText("SIGNED IN")).toBeTruthy());
  });

  // Rewritten per review: the previous version started already
  // isSignedIn=true and never actually exercised this code path. This one
  // starts signed-out, drives the real request-code flow, and asserts the
  // session_exists catch branch in sign-in-form.tsx actually runs.
  it("recovers from a session_exists error by actually triggering it", async () => {
    clerkState.setIsSignedIn(false);
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" }; // a session already exists server-side
    const user = userEvent.setup();

    mockSignInCreate.mockRejectedValue({ errors: [{ code: "session_exists", message: "Session already exists" }] });

    renderHarness();
    await user.type(screen.getByLabelText("you@example.com"), "already-signed-in@example.com");
    await user.click(screen.getByText("Sign In to Play"));

    expect(mockSignInCreate).toHaveBeenCalled();
    await waitFor(() => expect(authMeFetchCount).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText("SIGNED IN")).toBeTruthy());
  });

  it("logout clears the cached user and returns to signed-out, not a stale signed-in view", async () => {
    clerkState.setIsSignedIn(true);
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup();

    const { queryClient } = renderHarness();
    await waitFor(() => expect(screen.getByText("SIGNED IN")).toBeTruthy());
    expect(queryClient.getQueryData(AUTH_ME_KEY)).toEqual({ id: 1, role: "user" });

    await user.click(screen.getByText("Log Out"));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    // The specific regression this correction fixes: logout must actually
    // clear the cached user (to null, auth.me's real "not authenticated"
    // shape), not just flip isSignedIn and leave the previous user sitting
    // in the cache.
    await waitFor(() => expect(queryClient.getQueryData(AUTH_ME_KEY)).toBeNull());
    await waitFor(() => expect(screen.getByLabelText("you@example.com")).toBeTruthy());
    expect(screen.queryByText("SIGNED IN")).toBeNull();
  });

  // The core regression: session expiry -- Clerk itself flips isSignedIn
  // to false (e.g. a background token-refresh failure), with nothing
  // calling logout() and nothing clearing auth.me's cache. A stale
  // successful response must not keep the UI showing signed-in.
  it("session expiry with a stale cached user still resolves to signed-out", async () => {
    clerkState.setIsSignedIn(true);
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };

    renderHarness();
    await waitFor(() => expect(screen.getByText("SIGNED IN")).toBeTruthy());

    // Clerk reports the session is gone -- not a logout, not a cache clear.
    clerkState.setIsSignedIn(false);

    await waitFor(() => expect(screen.getByLabelText("you@example.com")).toBeTruthy());
    expect(screen.queryByText("SIGNED IN")).toBeNull();
  });
});

// Exercises useAuth()'s pending-bridge timeout directly (bypassing
// SignInForm/OTP, already proven above) via confirmSessionActivated/
// refresh/logout buttons that expose exactly the same status.kind a real
// screen (app/(tabs)/index.tsx, profile.tsx) branches on. This is what
// proves the bridge is genuinely *time-bounded* rather than only cleared by
// isSignedIn catching up or by logout -- the gap Codex flagged in review:
// a Clerk client whose isSignedIn simply never flips (not just slowly)
// must not leave the UI showing signed-in forever, backed only by a cached
// auth.me response.
function StatusHarness() {
  const { status, confirmSessionActivated, refresh, logout } = useAuth();
  return React.createElement(
    "div",
    null,
    React.createElement("span", { "data-testid": "status" }, status.kind),
    React.createElement("button", { onClick: () => confirmSessionActivated() }, "Confirm"),
    React.createElement("button", { onClick: () => refresh() }, "Refresh"),
    React.createElement("button", { onClick: () => logout() }, "Log Out"),
  );
}

function renderStatusHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StatusHarness)),
  );
  return { ...utils, queryClient };
}

function currentStatus() {
  return screen.getByTestId("status").textContent;
}

describe("useAuth pending-bridge timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the pending bridge and reaches signed-in on confirmSessionActivated even while isSignedIn never flips", async () => {
    clerkState.setIsSignedIn(false);
    authMeShouldFail = false;
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup({ delay: null });

    renderStatusHarness();
    expect(currentStatus()).toBe("signed-out");

    await user.click(screen.getByText("Confirm"));

    await waitFor(() => expect(currentStatus()).toBe("signed-in"));
    expect(clerkState.isSignedIn).toBe(false); // isolation held: the bridge, not Clerk, unlocked this
  });

  it("automatically expires the bridge after its bounded window when isSignedIn never catches up", async () => {
    clerkState.setIsSignedIn(false);
    authMeShouldFail = false;
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup({ delay: null });

    renderStatusHarness();
    await user.click(screen.getByText("Confirm"));
    await waitFor(() => expect(currentStatus()).toBe("signed-in"));

    await vi.advanceTimersByTimeAsync(SESSION_ACTIVATION_TIMEOUT_MS);

    await waitFor(() => expect(currentStatus()).toBe("sync-expired"));
  });

  it("after expiration, the same successful cached auth.me response cannot keep the UI signed in", async () => {
    clerkState.setIsSignedIn(false);
    authMeShouldFail = false;
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup({ delay: null });

    const { queryClient } = renderStatusHarness();
    await user.click(screen.getByText("Confirm"));
    await waitFor(() => expect(currentStatus()).toBe("signed-in"));

    await vi.advanceTimersByTimeAsync(SESSION_ACTIVATION_TIMEOUT_MS);
    await waitFor(() => expect(currentStatus()).toBe("sync-expired"));

    // The cached response is still sitting right there, unchanged --
    // proving it's specifically the expiry that refuses to authorize
    // signed-in, not an incidentally-empty cache.
    expect(queryClient.getQueryData(AUTH_ME_KEY)).toEqual({ id: 1, role: "user" });

    // Staying expired, not drifting back to signed-in on its own -- and a
    // fresh background success on the same cache key (simulating some
    // other screen's independent refetch) still isn't enough without a
    // new confirmSessionActivated() call re-opening the bridge.
    await user.click(screen.getByText("Refresh"));
    await waitFor(() => expect(authMeFetchCount).toBeGreaterThan(1));
    expect(currentStatus()).toBe("sync-expired");

    await vi.advanceTimersByTimeAsync(SESSION_ACTIVATION_TIMEOUT_MS);
    expect(currentStatus()).toBe("sync-expired");
  });

  // The exact production gap described in review: Clerk's isSignedIn stuck
  // at false is indistinguishable, from this module's perspective, between
  // "still catching up" and "the session actually expired while nothing
  // was watching." Either way, the bounded timeout is what prevents the
  // cached auth.me response from authorizing signed-in indefinitely.
  it("session expiration while the pending bridge is active cannot leave the user signed in indefinitely", async () => {
    clerkState.setIsSignedIn(false);
    authMeShouldFail = false;
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup({ delay: null });

    renderStatusHarness();
    await user.click(screen.getByText("Confirm"));
    await waitFor(() => expect(currentStatus()).toBe("signed-in"));

    // Well past the bounded window, in one jump and in smaller steps --
    // either way it must not still read signed-in.
    await vi.advanceTimersByTimeAsync(SESSION_ACTIVATION_TIMEOUT_MS + 60_000);
    expect(currentStatus()).not.toBe("signed-in");
    expect(currentStatus()).toBe("sync-expired");
  });

  it("a forced auth.me request that fails clears the pending state immediately instead of waiting out the timeout", async () => {
    clerkState.setIsSignedIn(false);
    authMeShouldFail = true;
    authMeFetchCount = 0;
    backendUser = null;
    const user = userEvent.setup({ delay: null });

    renderStatusHarness();
    await user.click(screen.getByText("Confirm"));

    // No independent proof of a session ever arrived -- must not sit in
    // "pending" waiting for a timeout that would only ever expire it the
    // same way; it's cleared right away.
    await waitFor(() => expect(currentStatus()).toBe("signed-out"));

    // Confirms it was actually cleared (not silently still "pending"):
    // advancing past the full bounded window must not flip it to
    // sync-expired, since there is no active bridge window anymore.
    await vi.advanceTimersByTimeAsync(SESSION_ACTIVATION_TIMEOUT_MS);
    expect(currentStatus()).toBe("signed-out");
  });

  it("logout clears the pending state and cached user even while the bridge is active", async () => {
    clerkState.setIsSignedIn(false);
    authMeShouldFail = false;
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup({ delay: null });

    const { queryClient } = renderStatusHarness();
    await user.click(screen.getByText("Confirm"));
    await waitFor(() => expect(currentStatus()).toBe("signed-in"));

    await user.click(screen.getByText("Log Out"));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    await waitFor(() => expect(currentStatus()).toBe("signed-out"));
    expect(queryClient.getQueryData(AUTH_ME_KEY)).toBeNull();

    // The bridge's timer must have been cancelled too, not just masked --
    // otherwise it would later fire and flip this to sync-expired even
    // though there's no bridge open anymore.
    await vi.advanceTimersByTimeAsync(SESSION_ACTIVATION_TIMEOUT_MS);
    expect(currentStatus()).toBe("signed-out");
  });
});
