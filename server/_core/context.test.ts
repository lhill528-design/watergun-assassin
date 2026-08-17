import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

const mockVerifyToken = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@clerk/backend", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  createClerkClient: () => ({ users: { getUser: (...args: unknown[]) => mockGetUser(...args) } }),
}));

const mockGetUserByClerkId = vi.fn();
const mockUpsertUser = vi.fn();

vi.mock("../db", () => ({
  getUserByClerkId: (...args: unknown[]) => mockGetUserByClerkId(...args),
  upsertUser: (...args: unknown[]) => mockUpsertUser(...args),
}));

// Imported after the mocks above so context.ts and routers.ts pick up the
// mocked @clerk/backend and ../db modules.
const { createContext } = await import("./context");
const { appRouter } = await import("../routers");

function makeOpts(token?: string): CreateExpressContextOptions {
  // createContext only reads opts.req.headers.authorization -- the rest of
  // CreateExpressContextOptions (res, tRPC's internal `info`) is unused by
  // it, so a minimal stub cast is enough here.
  return {
    req: { headers: token ? { authorization: `Bearer ${token}` } : {} },
    res: {},
  } as unknown as CreateExpressContextOptions;
}

describe("createContext + auth.me", () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockGetUser.mockReset();
    mockGetUserByClerkId.mockReset();
    mockUpsertUser.mockReset();
  });

  it("resolves the user for a valid token against an existing row", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user_1" });
    mockGetUserByClerkId.mockResolvedValue({ id: 1, clerkId: "user_1", role: "user" });
    mockUpsertUser.mockResolvedValue(undefined);

    const ctx = await createContext(makeOpts("valid-token"));
    expect(ctx.authError).toBeNull();
    expect(ctx.user).toEqual({ id: 1, clerkId: "user_1", role: "user" });

    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.me()).resolves.toEqual({ id: 1, clerkId: "user_1", role: "user" });
  });

  it("returns null with no token -- a normal signed-out state, not an error", async () => {
    const ctx = await createContext(makeOpts());
    expect(ctx.authError).toBeNull();
    expect(ctx.user).toBeNull();

    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.me()).resolves.toBeNull();
  });

  it("returns null with an invalid token -- also a normal signed-out state", async () => {
    mockVerifyToken.mockRejectedValue(new Error("bad signature"));

    const ctx = await createContext(makeOpts("garbage-token"));
    expect(ctx.authError).toBeNull();
    expect(ctx.user).toBeNull();

    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.me()).resolves.toBeNull();
  });

  // The exact production bug: a database/provisioning failure previously
  // returned 200 with data: null -- indistinguishable from "not signed in"
  // on the client, and the root symptom reported in production.
  it("surfaces a provisioning failure as a real query error, not 200 null", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user_2" });
    // No existing row, and db.ts's documented no-op-on-unavailable-database
    // behavior means both the initial lookup and the post-upsert re-fetch
    // return undefined -- simulating the database being unreachable.
    mockGetUserByClerkId.mockResolvedValue(undefined);
    mockGetUser.mockResolvedValue({
      emailAddresses: [{ id: "e1", emailAddress: "new@example.com" }],
      primaryEmailAddressId: "e1",
      fullName: "New User",
      firstName: "New",
    });
    mockUpsertUser.mockResolvedValue(undefined);

    const ctx = await createContext(makeOpts("valid-token"));
    expect(ctx.user).toBeNull();
    expect(ctx.authError).toBe("provisioning_failed");

    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.me()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("also surfaces a Clerk profile-fetch failure as a provisioning error", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "user_3" });
    mockGetUserByClerkId.mockResolvedValue(undefined);
    mockGetUser.mockRejectedValue(new Error("Clerk API unreachable"));

    const ctx = await createContext(makeOpts("valid-token"));
    expect(ctx.user).toBeNull();
    expect(ctx.authError).toBe("provisioning_failed");

    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.me()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
