import { beforeEach, describe, expect, it, vi } from "vitest";

// Router-level coverage proving geocoding.search requires auth and
// delegates to geocodeAddress with the caller's own user id (for its
// per-user rate limit). geocodeAddress's own behavior (caching,
// throttling, validation) is covered in server/geocoding.test.ts.
const mockGeocodeAddress = vi.fn();

vi.mock("./geocoding", () => ({
  geocodeAddress: (...args: unknown[]) => mockGeocodeAddress(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number | null) {
  return { req: {} as never, res: {} as never, user: userId ? ({ id: userId, isSuperAdmin: false } as never) : null, authError: null };
}

describe("geocoding.search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGeocodeAddress.mockResolvedValue({ displayName: "San Francisco, CA, USA", latitude: 37.7749, longitude: -122.4194 });
  });

  it("rejects an unauthenticated caller", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.geocoding.search({ address: "123 Main St" })).rejects.toThrow();
    expect(mockGeocodeAddress).not.toHaveBeenCalled();
  });

  it("delegates to geocodeAddress with the address and the caller's own user id", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    const result = await caller.geocoding.search({ address: "123 Main St" });

    expect(result).toEqual({ displayName: "San Francisco, CA, USA", latitude: 37.7749, longitude: -122.4194 });
    expect(mockGeocodeAddress).toHaveBeenCalledWith("123 Main St", 7);
  });

  it("propagates a rejection from geocodeAddress (e.g. rate limit, no results) as-is", async () => {
    mockGeocodeAddress.mockRejectedValue(new Error("Too many address searches. Wait a few minutes and try again."));
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.geocoding.search({ address: "123 Main St" })).rejects.toThrow("Too many address searches");
  });
});
