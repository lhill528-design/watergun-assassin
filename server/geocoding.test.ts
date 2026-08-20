import { beforeEach, describe, expect, it, vi } from "vitest";

// geocodeAddress proxies OSM Nominatim server-side (expo-location's
// Location.geocodeAsync only exists on Android/iOS, so web needs this).
// fetchImpl is injected so these tests never touch the network. Module
// state (cache, rate-limit counters, throttle clock) is module-scoped, so
// each test re-imports a fresh instance via vi.resetModules().
function nominatimResult(overrides: Partial<{ lat: string; lon: string; display_name: string }> = {}) {
  return [{ lat: "37.774900", lon: "-122.419400", display_name: "San Francisco, CA, USA", ...overrides }];
}

type FakeFetch = (url: string, options: { headers: Record<string, string> }) => Promise<Response>;

function makeFetch(response: { ok: boolean; json?: () => Promise<unknown> } | (() => Promise<Response>)) {
  const impl: FakeFetch = typeof response === "function"
    ? (response as () => Promise<Response>)
    : (async () => response as unknown as Response);
  return vi.fn(impl);
}

async function freshGeocodeAddress() {
  vi.resetModules();
  const mod = await import("./geocoding");
  return mod.geocodeAddress;
}

describe("geocodeAddress", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("encodes the address safely into the outbound request URL", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    await geocodeAddress('123 Main St & "Weird" <Ave>', 1, fetchImpl as any);

    const calledUrl = new URL((fetchImpl.mock.calls[0][0] as string));
    expect(calledUrl.searchParams.get("q")).toBe('123 Main St & "Weird" <Ave>');
    expect(calledUrl.searchParams.get("limit")).toBe("1"); // one result only
  });

  it("sends an identifying User-Agent", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    await geocodeAddress("123 Main St", 1, fetchImpl as any);

    const options = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(options.headers["User-Agent"]).toContain("WatergunAssassin");
  });

  it("returns a normalized display name plus validated coordinates", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    const result = await geocodeAddress("123 Main St", 1, fetchImpl as any);

    expect(result).toEqual({ displayName: "San Francisco, CA, USA", latitude: 37.7749, longitude: -122.4194 });
  });

  it("caches identical normalized queries so the second call never hits fetch again", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    await geocodeAddress("  123 Main St  ", 1, fetchImpl as any);
    await geocodeAddress("123   MAIN   ST", 1, fetchImpl as any); // same normalized query, different casing/whitespace

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throttles two distinct queries to at least ~1 second apart", async () => {
    vi.useFakeTimers();
    try {
      const geocodeAddress = await freshGeocodeAddress();
      const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

      const start = Date.now();
      const run = (async () => {
        await geocodeAddress("Address One", 1, fetchImpl as any);
        await geocodeAddress("Address Two", 1, fetchImpl as any); // distinct cache key -- must actually hit fetch again
      })();
      await vi.runAllTimersAsync();
      await run;
      const elapsed = Date.now() - start;

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects empty input without calling fetch", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    await expect(geocodeAddress("   ", 1, fetchImpl as any)).rejects.toThrow("Enter an address");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized address without calling fetch", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    await expect(geocodeAddress("x".repeat(500), 1, fetchImpl as any)).rejects.toThrow("too long");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows a useful message when Nominatim returns no results", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => [] });

    await expect(geocodeAddress("nowhere at all", 1, fetchImpl as any)).rejects.toThrow("Couldn't find that address");
  });

  it("shows a useful message on a malformed (out-of-range) coordinate in the response", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult({ lat: "999", lon: "999" }) });

    await expect(geocodeAddress("weird result", 1, fetchImpl as any)).rejects.toThrow("Couldn't find that address");
  });

  it("shows a useful message on an upstream HTTP error, without leaking upstream details", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: false });

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("temporarily unavailable");
  });

  it("shows a useful message when the network request itself throws", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("temporarily unavailable");
  });

  it("enforces a per-user rate limit", async () => {
    vi.useFakeTimers();
    try {
      const geocodeAddress = await freshGeocodeAddress();
      const fetchImpl = makeFetch(async () => ({ ok: true, json: async () => nominatimResult() } as unknown as Response));

      // Each call must be for a distinct address so the cache doesn't
      // short-circuit before the rate limiter is even reached, and
      // distinct users must not interfere with each other's limit.
      const run = (async () => {
        for (let i = 0; i < 20; i++) {
          await geocodeAddress(`Address ${i}`, 42, fetchImpl as any);
        }
      })();
      await vi.runAllTimersAsync();
      await run;

      await expect(geocodeAddress("One too many", 42, fetchImpl as any)).rejects.toThrow("Too many address searches");
      // A different user is unaffected by user 42's limit.
      const otherUserPromise = expect(geocodeAddress("Address 0", 43, fetchImpl as any)).resolves.toBeDefined();
      await vi.runAllTimersAsync();
      await otherUserPromise;
    } finally {
      vi.useRealTimers();
    }
  });
});
