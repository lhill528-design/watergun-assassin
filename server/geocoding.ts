// Server-side address search, primarily OpenStreetMap Nominatim
// (https://nominatim.openstreetmap.org) with the official U.S. Census
// Bureau geocoder as a free, no-key fallback -- so address-entry screens
// work on web too, since expo-location's Location.geocodeAsync only
// exists on Android/iOS.
//
// Nominatim follows its usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) deliberately:
// user-triggered lookups only (no autocomplete -- callers must not wire
// this to onChangeText), an absolute max of one outbound request per
// second for this whole service instance, an identifying User-Agent and
// Referer, and caching so a repeated identical search doesn't hit
// Nominatim again.
//
// The Census geocoder (https://geocoding.geo.census.gov, see
// https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)
// is used only when Nominatim returns no match, a network failure, a
// 403/429, or a 5xx -- it's intended for public developer use and needs
// no API key, but only covers U.S., Puerto Rico, and U.S. Island Area
// addresses, which is exactly why it's the fallback and not the primary.
//
// Neither provider's request/response is ever logged verbatim: only the
// provider name, the stage a failure happened at, an HTTP status if there
// was one, and the failing error's class name -- never the address, the
// full request URL (which embeds the address as a query param), the
// response body, coordinates, or credentials.
import { ENV } from "./_core/env";

export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

const MAX_ADDRESS_LENGTH = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // addresses don't move; a day is safe and cuts upstream load a lot
const MIN_REQUEST_INTERVAL_MS = 1100; // Nominatim's policy is "max 1/sec" -- pad slightly past the boundary
const USER_RATE_LIMIT = 20;
const USER_RATE_WINDOW_MS = 10 * 60 * 1000;

const cache = new Map<string, { result: GeocodeResult; expiresAt: number }>();
const userRequestTimestamps = new Map<number, number[]>();
let lastUpstreamRequestAt = 0;
// Every call awaits the previous call's throttle before checking its own
// wait time, so concurrent requests get serialized to >=1s apart instead
// of racing to read a stale lastUpstreamRequestAt at the same instant.
// Only Nominatim is throttled this way -- the Census fallback has no such
// usage-policy constraint.
let throttleLock: Promise<void> = Promise.resolve();

function checkUserRateLimit(userId: number) {
  const now = Date.now();
  const recent = (userRequestTimestamps.get(userId) ?? []).filter((t) => now - t < USER_RATE_WINDOW_MS);
  if (recent.length >= USER_RATE_LIMIT) {
    throw new Error("Too many address searches. Wait a few minutes and try again.");
  }
  recent.push(now);
  userRequestTimestamps.set(userId, recent);
}

function normalizeQuery(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

async function throttleUpstreamRequest(): Promise<void> {
  const previous = throttleLock;
  let release: () => void = () => {};
  throttleLock = new Promise((resolve) => { release = resolve; });
  await previous;
  const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastUpstreamRequestAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastUpstreamRequestAt = Date.now();
  release();
}

function isValidCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function errorClassName(err: unknown): string {
  return err instanceof Error ? err.constructor.name : typeof err;
}

// Credential-safe diagnostics: only the provider name, the stage this
// happened at, an HTTP status if there was one, and the failing error's
// constructor name. Never the address, the full request URL, the
// response body, coordinates, or credentials -- reproduce a failure by
// re-running geocodeAddress with a *public test address*, never a
// player's private one.
function logGeocodingDiagnostic(provider: "nominatim" | "census", stage: string, details: { status?: number; error?: unknown } = {}): void {
  const parts = [`provider=${provider}`, `stage=${stage}`];
  if (details.status !== undefined) parts.push(`status=${details.status}`);
  if (details.error !== undefined) parts.push(`errorClass=${errorClassName(details.error)}`);
  console.warn(`[Geocoding] ${parts.join(" ")}`);
}

type ProviderOutcome =
  | { kind: "success"; result: GeocodeResult }
  // No match, or a failure worth trying the next provider for.
  | { kind: "fallback"; reason: "empty_result" | "unavailable" }
  // Not worth trying another provider for (e.g. this app's own request
  // was malformed) -- surface the "unavailable" error immediately.
  | { kind: "fatal" };

async function tryNominatim(address: string, fetchImpl: typeof fetch): Promise<ProviderOutcome> {
  await throttleUpstreamRequest();

  const url = new URL("/search", ENV.geocodingBaseUrl);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1"); // one result only, per policy

  const userAgent = `WatergunAssassin/1.0${ENV.geocodingContact ? ` (${ENV.geocodingContact})` : ""}`;

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { "User-Agent": userAgent, Referer: ENV.geocodingReferer, Accept: "application/json" },
    });
  } catch (err) {
    logGeocodingDiagnostic("nominatim", "network_error", { error: err });
    return { kind: "fallback", reason: "unavailable" };
  }

  if (!response.ok) {
    logGeocodingDiagnostic("nominatim", "http_error", { status: response.status });
    return isRetryableStatus(response.status) ? { kind: "fallback", reason: "unavailable" } : { kind: "fatal" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    logGeocodingDiagnostic("nominatim", "parse_error", { error: err });
    return { kind: "fatal" };
  }

  const first = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  const latitude = first ? Number(first.lat) : NaN;
  const longitude = first ? Number(first.lon) : NaN;

  if (!first || !isValidCoordinate(latitude, longitude)) {
    logGeocodingDiagnostic("nominatim", "empty_result");
    return { kind: "fallback", reason: "empty_result" };
  }

  logGeocodingDiagnostic("nominatim", "success");
  return {
    kind: "success",
    result: { displayName: typeof first.display_name === "string" ? first.display_name : address, latitude, longitude },
  };
}

async function tryCensus(address: string, fetchImpl: typeof fetch): Promise<ProviderOutcome> {
  const url = new URL(`${ENV.censusGeocodingBaseUrl}/locations/onelineaddress`);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
  } catch (err) {
    logGeocodingDiagnostic("census", "network_error", { error: err });
    return { kind: "fatal" };
  }

  if (!response.ok) {
    logGeocodingDiagnostic("census", "http_error", { status: response.status });
    return { kind: "fatal" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    logGeocodingDiagnostic("census", "parse_error", { error: err });
    return { kind: "fatal" };
  }

  const matches = (body as { result?: { addressMatches?: unknown[] } } | null)?.result?.addressMatches;
  const first = Array.isArray(matches) ? (matches[0] as Record<string, unknown> | undefined) : undefined;
  const coordinates = first?.coordinates as { x?: unknown; y?: unknown } | undefined;
  const longitude = coordinates ? Number(coordinates.x) : NaN;
  const latitude = coordinates ? Number(coordinates.y) : NaN;

  if (!first || !coordinates || !isValidCoordinate(latitude, longitude)) {
    logGeocodingDiagnostic("census", "empty_result");
    return { kind: "fatal" };
  }

  logGeocodingDiagnostic("census", "success");
  return {
    kind: "success",
    result: { displayName: typeof first.matchedAddress === "string" ? first.matchedAddress : address, latitude, longitude },
  };
}

// fetchImpl is injectable purely for testability (no real network calls in
// tests); production callers always use the default global fetch. To
// reproduce an outbound-request issue by hand, call this with a public
// test address (e.g. "1600 Pennsylvania Ave NW, Washington, DC") --
// never a player's actual address.
export async function geocodeAddress(
  rawAddress: string,
  userId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult> {
  const address = rawAddress.trim();
  if (!address) throw new Error("Enter an address to search.");
  if (address.length > MAX_ADDRESS_LENGTH) throw new Error("That address is too long to search.");

  checkUserRateLimit(userId);

  const cacheKey = normalizeQuery(address);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const nominatim = await tryNominatim(address, fetchImpl);
  if (nominatim.kind === "success") {
    cache.set(cacheKey, { result: nominatim.result, expiresAt: Date.now() + CACHE_TTL_MS });
    return nominatim.result;
  }
  if (nominatim.kind === "fatal") {
    throw new Error("Address search is temporarily unavailable. Try again shortly.");
  }

  const census = await tryCensus(address, fetchImpl);
  if (census.kind === "success") {
    cache.set(cacheKey, { result: census.result, expiresAt: Date.now() + CACHE_TTL_MS });
    return census.result;
  }

  throw new Error(
    nominatim.reason === "empty_result"
      ? "Couldn't find that address. Try being more specific."
      : "Address search is temporarily unavailable. Try again shortly.",
  );
}
