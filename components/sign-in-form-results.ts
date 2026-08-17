// Pure helpers for interpreting Clerk's sign-in/sign-up attempt results and
// errors. Kept dependency-free (no Clerk/React imports, just the minimal
// shapes this module actually reads) so the branching logic is directly
// unit-testable without mocking the Clerk SDK.

export type VerifyOutcome =
  | { kind: "complete"; sessionId: string }
  | { kind: "missing_requirements"; missingFields: string[]; unverifiedFields: string[] }
  | { kind: "needs_more_steps"; status: string };

interface SignInAttemptResult {
  status: string | null;
  createdSessionId?: string | null;
}

interface SignUpAttemptResult {
  status: string | null;
  createdSessionId?: string | null;
  missingFields?: string[] | null;
  unverifiedFields?: string[] | null;
}

// This app only configures email-code sign-in (no MFA/password/OAuth), so
// "complete" and "missing_requirements" (sign-up only) are the only
// statuses expected in normal operation. Every other status -- a second
// factor, a new password requirement, etc. -- falls back to
// "needs_more_steps" rather than being silently treated as failure or
// success, since this flow has no UI to carry the user through those steps.
export function interpretSignInResult(result: SignInAttemptResult): VerifyOutcome {
  if (result.status === "complete" && result.createdSessionId) {
    return { kind: "complete", sessionId: result.createdSessionId };
  }
  return { kind: "needs_more_steps", status: result.status ?? "unknown" };
}

export function interpretSignUpResult(result: SignUpAttemptResult): VerifyOutcome {
  if (result.status === "complete" && result.createdSessionId) {
    return { kind: "complete", sessionId: result.createdSessionId };
  }
  if (result.status === "missing_requirements") {
    return {
      kind: "missing_requirements",
      missingFields: result.missingFields ?? [],
      unverifiedFields: result.unverifiedFields ?? [],
    };
  }
  return { kind: "needs_more_steps", status: result.status ?? "unknown" };
}

export function describeVerifyOutcome(outcome: VerifyOutcome): string {
  switch (outcome.kind) {
    case "complete":
      return "";
    case "missing_requirements": {
      const parts = [
        outcome.missingFields.length ? `missing ${outcome.missingFields.join(", ")}` : null,
        outcome.unverifiedFields.length ? `unverified ${outcome.unverifiedFields.join(", ")}` : null,
      ].filter((part): part is string => Boolean(part));
      return parts.length
        ? `Additional info required (${parts.join("; ")}). Contact support.`
        : "Additional info required to finish signing up. Contact support.";
    }
    case "needs_more_steps":
      return `Sign-in requires an extra step ("${outcome.status}") this app doesn't support yet. Contact support.`;
  }
}

// Thrown by signIn.create()/signUp.create() when the browser already has an
// active Clerk session. Detecting this by error code (rather than matching
// the message text) lets requestCode() recover instead of showing a raw
// "Session already exists" error to someone who is, in fact, already
// signed in -- the fix is to let the parent screen notice the active
// session, not to retry sending a code.
export function isSessionExistsError(err: unknown): boolean {
  const errors = (err as { errors?: Array<{ code?: string }> })?.errors;
  return errors?.some((e) => e.code === "session_exists") ?? false;
}
