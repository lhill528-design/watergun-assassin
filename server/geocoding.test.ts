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

function censusResult(overrides: Partial<{ x: number; y: number; matchedAddress: string }> = {}) {
  return { result: { addressMatches: [{ matchedAddress: "1600 Pennsylvania Ave NW, WASHINGTON, DC, 20500", coordinates: { x: -77.0365, y: 38.8977, ...overrides }, ...overrides }] } };
}

// Routes a fake fetch by provider so Nominatim and Census can behave
// independently within one test -- everything sent to a URL containing
// "census.gov" is treated as the Census call, everything else as
// Nominatim.
function makeMultiProviderFetch(handlers: {
  nominatim?: () => Promise<{ ok: boolean; json?: () => Promise<unknown> }>;
  census?: () => Promise<{ ok: boolean; json?: () => Promise<unknown> }>;
}) {
  return vi.fn(async (url: string, _options: unknown) => {
    const isCensus = url.includes("census.gov");
    const handler = isCensus ? handlers.census : handlers.nominatim;
    if (!handler) throw new Error(`unexpected call to ${isCensus ? "census" : "nominatim"}`);
    return (await handler()) as unknown as Response;
  });
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

  it("sends a Referer pointing at this app's real production site by default", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeFetch({ ok: true, json: async () => nominatimResult() });

    await geocodeAddress("123 Main St", 1, fetchImpl as any);

    const options = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(options.headers["Referer"]).toBe("https://watergun-assassin.vercel.app/");
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

describe("geocodeAddress: Census fallback", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("Nominatim success: never calls Census", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => nominatimResult() }),
    });

    const result = await geocodeAddress("123 Main St", 1, fetchImpl as any);

    expect(result).toEqual({ displayName: "San Francisco, CA, USA", latitude: 37.7749, longitude: -122.4194 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Nominatim empty -> Census success: falls back and returns the Census result", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => [] }),
      census: async () => ({ ok: true, json: async () => censusResult() }),
    });

    const result = await geocodeAddress("1600 Pennsylvania Ave NW, Washington, DC", 1, fetchImpl as any);

    expect(result).toEqual({ displayName: "1600 Pennsylvania Ave NW, WASHINGTON, DC, 20500", latitude: 38.8977, longitude: -77.0365 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("Nominatim network failure -> Census success: falls back and returns the Census result", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => { throw new Error("ECONNREFUSED"); },
      census: async () => ({ ok: true, json: async () => censusResult() }),
    });

    const result = await geocodeAddress("123 Main St", 1, fetchImpl as any);

    expect(result.displayName).toBe("1600 Pennsylvania Ave NW, WASHINGTON, DC, 20500");
  });

  it("Nominatim 429 -> Census success: a retryable HTTP status also falls back", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("census.gov")) return { ok: true, json: async () => censusResult() } as unknown as Response;
      return { ok: false, status: 429 } as unknown as Response;
    });

    const result = await geocodeAddress("123 Main St", 1, fetchImpl as any);

    expect(result.displayName).toBe("1600 Pennsylvania Ave NW, WASHINGTON, DC, 20500");
  });

  it("Nominatim 5xx -> Census success: a 5xx also falls back", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("census.gov")) return { ok: true, json: async () => censusResult() } as unknown as Response;
      return { ok: false, status: 503 } as unknown as Response;
    });

    const result = await geocodeAddress("123 Main St", 1, fetchImpl as any);

    expect(result.displayName).toBe("1600 Pennsylvania Ave NW, WASHINGTON, DC, 20500");
  });

  it("Nominatim non-retryable HTTP error (e.g. 400) does not attempt Census at all", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response);

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("temporarily unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("both providers failing (network errors) surfaces the temporarily-unavailable message", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => { throw new Error("ECONNREFUSED"); },
      census: async () => { throw new Error("ETIMEDOUT"); },
    });

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("temporarily unavailable");
  });

  it("both providers returning no match surfaces the not-found message", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => [] }),
      census: async () => ({ ok: true, json: async () => ({ result: { addressMatches: [] } }) }),
    });

    await expect(geocodeAddress("nowhere at all", 1, fetchImpl as any)).rejects.toThrow("Couldn't find that address");
  });

  it("handles malformed Census data gracefully (missing addressMatches)", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => [] }),
      census: async () => ({ ok: true, json: async () => ({ result: {} }) }),
    });

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("Couldn't find that address");
  });

  it("handles malformed Census data gracefully (completely unexpected shape)", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => [] }),
      census: async () => ({ ok: true, json: async () => "not even an object" }),
    });

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("Couldn't find that address");
  });

  it("validates Census coordinates just like Nominatim's, rejecting out-of-range values", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => [] }),
      census: async () => ({ ok: true, json: async () => censusResult({ x: 999, y: 999 }) }),
    });

    await expect(geocodeAddress("123 Main St", 1, fetchImpl as any)).rejects.toThrow("Couldn't find that address");
  });

  it("caches a successful Census fallback result, so a repeat query never hits fetch again", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const fetchImpl = makeMultiProviderFetch({
      nominatim: async () => ({ ok: true, json: async () => [] }),
      census: async () => ({ ok: true, json: async () => censusResult() }),
    });

    await geocodeAddress("123 Main St", 1, fetchImpl as any);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // nominatim (miss) + census (hit)

    await geocodeAddress("123   MAIN   ST", 1, fetchImpl as any); // same normalized query
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no new calls -- served from cache
  });

  it("logs only credential-safe diagnostics -- provider, stage, status, error class -- never the address, URL, response body, or coordinates", async () => {
    const geocodeAddress = await freshGeocodeAddress();
    const secretAddress = "742 Evergreen Terrace, Springfield";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("census.gov")) return { ok: false, status: 500 } as unknown as Response;
      throw new Error("ECONNREFUSED: connection to db_admin@10.0.0.7 failed");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(geocodeAddress(secretAddress, 1, fetchImpl as any)).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    const loggedText = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).not.toContain(secretAddress);
    expect(loggedText).not.toContain("db_admin");
    expect(loggedText).not.toContain("10.0.0.7");
    expect(loggedText).not.toContain("geocoding.geo.census.gov"); // no full URL either
    expect(loggedText).not.toContain("nominatim.openstreetmap.org");
    expect(loggedText).toContain("provider=nominatim");
    expect(loggedText).toContain("stage=network_error");
    expect(loggedText).toContain("errorClass=Error");
    expect(loggedText).toContain("provider=census");
    expect(loggedText).toContain("stage=http_error");
    expect(loggedText).toContain("status=500");

    warnSpy.mockRestore();
  });
});
