// Shared client helper for address search, backed by the geocoding.search
// tRPC procedure (server/geocoding.ts), which proxies OpenStreetMap
// Nominatim server-side. expo-location's Location.geocodeAsync only works
// on Android/iOS -- calling it on web silently does nothing, so every
// address-entry screen (map-powerups, map guess, Sanctuary/Decoy in shop)
// goes through this instead. Device GPS/current-location still goes
// through expo-location directly; this is address search only.
//
// User-triggered only -- call this from a button press, never from
// onChangeText/autocomplete (Nominatim's usage policy prohibits that, and
// the server enforces throttling/rate limits regardless).
import type { trpc } from "@/lib/trpc";

export interface GeocodeResult {
  displayName: string;
  latitude: number;
  longitude: number;
}

// Shown beside every address-search control per Nominatim's attribution
// requirement (distinct from the map tile attribution, which the map
// component itself already renders).
export const GEOCODING_ATTRIBUTION = "Address search © OpenStreetMap contributors";

export async function searchAddress(
  utils: ReturnType<typeof trpc.useUtils>,
  address: string,
): Promise<GeocodeResult> {
  return utils.geocoding.search.fetch({ address });
}
