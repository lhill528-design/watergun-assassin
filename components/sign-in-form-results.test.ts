import { describe, expect, it } from "vitest";
import {
  describeVerifyOutcome,
  interpretSignInResult,
  interpretSignUpResult,
  isSessionExistsError,
} from "./sign-in-form-results";

describe("interpretSignInResult (existing-user OTP sign-in)", () => {
  it("resolves a complete sign-in to its session id", () => {
    expect(interpretSignInResult({ status: "complete", createdSessionId: "sess_123" })).toEqual({
      kind: "complete",
      sessionId: "sess_123",
    });
  });

  it("falls back to needs_more_steps for any other status this app doesn't support", () => {
    expect(interpretSignInResult({ status: "needs_second_factor" })).toEqual({
      kind: "needs_more_steps",
      status: "needs_second_factor",
    });
  });

  it("treats complete without a session id as needs_more_steps rather than crashing", () => {
    expect(interpretSignInResult({ status: "complete", createdSessionId: null })).toEqual({
      kind: "needs_more_steps",
      status: "complete",
    });
  });
});

describe("interpretSignUpResult (new-user OTP sign-up)", () => {
  it("resolves a complete sign-up to its session id", () => {
    expect(interpretSignUpResult({ status: "complete", createdSessionId: "sess_456" })).toEqual({
      kind: "complete",
      sessionId: "sess_456",
    });
  });

  it("surfaces missing and unverified fields on missing_requirements", () => {
    expect(
      interpretSignUpResult({
        status: "missing_requirements",
        missingFields: ["last_name"],
        unverifiedFields: ["email_address"],
      }),
    ).toEqual({
      kind: "missing_requirements",
      missingFields: ["last_name"],
      unverifiedFields: ["email_address"],
    });
  });

  it("defaults missing/unverified fields to empty arrays when Clerk omits them", () => {
    expect(interpretSignUpResult({ status: "missing_requirements" })).toEqual({
      kind: "missing_requirements",
      missingFields: [],
      unverifiedFields: [],
    });
  });

  it("falls back to needs_more_steps for any other status", () => {
    expect(interpretSignUpResult({ status: "abandoned" })).toEqual({
      kind: "needs_more_steps",
      status: "abandoned",
    });
  });
});

describe("describeVerifyOutcome", () => {
  it("describes missing_requirements with both field lists", () => {
    expect(
      describeVerifyOutcome({
        kind: "missing_requirements",
        missingFields: ["last_name"],
        unverifiedFields: ["email_address"],
      }),
    ).toBe("Additional info required (missing last_name; unverified email_address). Contact support.");
  });

  it("describes missing_requirements with no field lists using a generic message", () => {
    expect(describeVerifyOutcome({ kind: "missing_requirements", missingFields: [], unverifiedFields: [] })).toBe(
      "Additional info required to finish signing up. Contact support.",
    );
  });

  it("describes needs_more_steps with the raw status", () => {
    expect(describeVerifyOutcome({ kind: "needs_more_steps", status: "needs_second_factor" })).toContain(
      "needs_second_factor",
    );
  });
});

describe("isSessionExistsError (session already active)", () => {
  it("detects Clerk's session_exists error code", () => {
    expect(isSessionExistsError({ errors: [{ code: "session_exists" }] })).toBe(true);
  });

  it("does not misfire on unrelated Clerk errors", () => {
    expect(isSessionExistsError({ errors: [{ code: "form_identifier_not_found" }] })).toBe(false);
  });

  it("handles non-Clerk-shaped errors without throwing", () => {
    expect(isSessionExistsError(new Error("network down"))).toBe(false);
    expect(isSessionExistsError(null)).toBe(false);
    expect(isSessionExistsError(undefined)).toBe(false);
  });
});
