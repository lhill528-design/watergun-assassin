import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

function requestFor(hostname: string, protocol = "https") {
  return {
    hostname,
    protocol,
    headers: {},
  } as unknown as Request;
}

describe("getSessionCookieOptions", () => {
  it("uses a Safari-compatible host-only cookie for published Manus Space apps", () => {
    expect(getSessionCookieOptions(requestFor("watergunapp-my8bc78r.manus.space"))).toEqual({
      domain: undefined,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("keeps parent-domain sharing for separate managed preview hosts", () => {
    expect(getSessionCookieOptions(requestFor("3000-example.manuspre.computer"))).toMatchObject({
      domain: ".manuspre.computer",
      sameSite: "none",
      secure: true,
    });
  });
});
