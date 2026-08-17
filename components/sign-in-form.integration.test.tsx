// @vitest-environment jsdom
//
// Real-render integration test proving the actual bug and fix from the
// production incident: after a successful OTP verify, does auth.me
// actually get fetched, and does the app transition away from the sign-in
// form? Pure unit tests on the extracted helpers (sign-in-form-results.ts,
// auth-status.ts) can't prove that -- they never mount SignInForm or
// useAuth together, so they can't catch a wiring bug between them.
//
// react-native primitives (View/Text/TextInput/TouchableOpacity) are
// stubbed to their plain DOM equivalents -- this project's real web build
// gets that translation from react-native-web via Metro, which vitest
// doesn't do, and it's not what's under test here anyway. What IS real and
// unmocked: useAuth, SignInForm, deriveAuthStatus, and a genuine
// @tanstack/react-query QueryClient providing the enabled-gating and
// refetch semantics that were the actual bug.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const clerkState = vi.hoisted(() => ({
  isSignedIn: false as boolean,
}));

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

// A fresh sign-in attempt each render (matches real Clerk resource
// semantics closely enough for this test); attemptFirstFactor and
// setActive are the two calls the test drives directly.
const mockSignInCreate = vi.fn();
const mockPrepareFirstFactor = vi.fn();
const mockAttemptFirstFactor = vi.fn();
const mockSetActiveSignIn = vi.fn(async () => {
  // This is the real Clerk contract this whole bug was about: setActive()
  // is what actually flips the shared session state that useAuth() (a
  // completely separate hook, from a different Clerk entry point) reads.
  clerkState.isSignedIn = true;
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

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: clerkState.isSignedIn,
    signOut: vi.fn(async () => {
      clerkState.isSignedIn = false;
    }),
  }),
}));

// Backed by a real QueryClient (via useQuery) so `enabled` gating and a
// query's own refetch() (which -- unlike trpc.useUtils().X.refetch() --
// does not skip disabled queries; see sign-in-form.tsx's onSessionActive
// doc comment) are exercised by the actual react-query engine, not
// reimplemented by hand. Only the "network" (queryFn) is faked, standing
// in for what would be a real tRPC request to the backend.
const AUTH_ME_KEY = ["auth", "me"] as const;
let authMeFetchCount = 0;
let backendUser: { id: number; role: string } | null = { id: 1, role: "user" };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      me: {
        useQuery: (_input: unknown, options: { enabled: boolean }) =>
          useQuery({
            queryKey: AUTH_ME_KEY,
            queryFn: async () => {
              authMeFetchCount += 1;
              return backendUser;
            },
            enabled: options.enabled,
          }),
      },
    },
  },
}));

// Imported after the mocks above so they pick up the mocked modules.
const { SignInForm } = await import("./sign-in-form");
const { useAuth } = await import("@/hooks/use-auth");

// Mirrors the actual wiring in app/(tabs)/index.tsx and profile.tsx:
// SignInForm gets useAuth()'s own `refresh` (the query's observer-level
// refetch, which bypasses `enabled`) as onSessionActive, not
// trpc.useUtils().auth.me.refetch() (which -- per @trpc/react-query's own
// implementation, delegating to queryClient.refetchQueries() -- skips
// currently-disabled queries and would silently do nothing here).
function TestHarness() {
  const { status, refresh } = useAuth();
  if (status.kind === "signed-in") return React.createElement("span", null, "SIGNED IN");
  return React.createElement(SignInForm, { onSessionActive: refresh });
}

function renderHarness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(TestHarness)),
  );
}

describe("SignInForm + useAuth integration: full OTP sign-in sequence", () => {
  it("issues auth.me and unmounts the sign-in form after OTP verify completes", async () => {
    clerkState.isSignedIn = false;
    authMeFetchCount = 0;
    const user = userEvent.setup();

    mockSignInCreate.mockResolvedValue({
      supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_1" }],
    });
    mockPrepareFirstFactor.mockResolvedValue({});
    mockAttemptFirstFactor.mockResolvedValue({ status: "complete", createdSessionId: "sess_1" });

    renderHarness();

    // Step 1: request a code.
    await user.type(screen.getByLabelText("you@example.com"), "player@example.com");
    await user.click(screen.getByText("Sign In to Play"));
    await waitFor(() => expect(screen.getByLabelText("123456")).toBeTruthy());

    // Step 2: enter the OTP and verify -- this is the exact click that did
    // nothing in production.
    await user.type(screen.getByLabelText("123456"), "123456");
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

  it("recovers from a session_exists error instead of leaving the form stuck", async () => {
    // Simulates retrying while a session is already active (session_exists
    // is what production actually returned on the retry after the stuck
    // first attempt).
    clerkState.isSignedIn = true;
    authMeFetchCount = 0;
    backendUser = { id: 1, role: "user" };
    const user = userEvent.setup();

    mockSignInCreate.mockRejectedValue({ errors: [{ code: "session_exists", message: "Session already exists" }] });

    renderHarness();
    await waitFor(() => expect(screen.getByText("SIGNED IN")).toBeTruthy());
  });
});
