// Server-side address search, proxying the public OpenStreetMap Nominatim
// API (https://nominatim.openstreetmap.org) so address-entry screens work
// on web too -- expo-location's Location.geocodeAsync only exists on
// Android/iOS, so calling it from web silently does nothing there.
//
// This follows Nominatim's usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) deliberately:
// user-triggered lookups only (no autocomplete -- callers must not wire
// this to onChangeText), an absolute max of one outbound request per
// second for this whole service instance, an identifying User-Agent and
// Referer, and caching so a repeated identical search doesn't hit
// Nominatim again. It never logs the address, the upstream response body,
// or the full request URL -- only that a lookup happened/failed.
import { ENV } from "./_core/env";

export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

const MAX_ADDRESS_LENGTH = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // addresses don't move; a day is safe and cuts upstream load a lot
const MIN_REQUEST_INTERVAL_MS = 1100; // policy is "max 1/sec" -- pad slightly past the boundary
const USER_RATE_LIMIT = 20;
const USER_RATE_WINDOW_MS = 10 * 60 * 1000;

const cache = new Map<string, { result: GeocodeResult; expiresAt: number }>();
const userRequestTimestamps = new Map<number, number[]>();
let lastUpstreamRequestAt = 0;
// Every call awaits the previous call's throttle before checking its own
// wait time, so concurrent requests get serialized to >=1s apart instead
// of racing to read a stale lastUpstreamRequestAt at the same instant.
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

// fetchImpl is injectable purely for testability (no real network calls in
// tests); production callers always use the default global fetch.
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

  await throttleUpstreamRequest();

  const url = new URL("/search", ENV.geocodingBaseUrl);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1"); // one result only, per policy

  const userAgent = `WatergunAssassin/1.0${ENV.geocodingContact ? ` (${ENV.geocodingContact})` : ""}`;
  const referer = ENV.geocodingContact ? undefined : "https://watergun-assassin.app";

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: {
        "User-Agent": userAgent,
        ...(referer ? { Referer: referer } : {}),
        Accept: "application/json",
      },
    });
  } catch {
    throw new Error("Address search is temporarily unavailable. Try again shortly.");
  }

  if (!response.ok) {
    throw new Error("Address search is temporarily unavailable. Try again shortly.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Address search is temporarily unavailable. Try again shortly.");
  }

  const first = Array.isArray(body) ? (body[0] as Record<string, unknown> | undefined) : undefined;
  const latitude = first ? Number(first.lat) : NaN;
  const longitude = first ? Number(first.lon) : NaN;

  if (!first || !isValidCoordinate(latitude, longitude)) {
    throw new Error("Couldn't find that address. Try being more specific.");
  }

  const result: GeocodeResult = {
    displayName: typeof first.display_name === "string" ? first.display_name : address,
    latitude,
    longitude,
  };
  cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
