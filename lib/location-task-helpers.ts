// Pure helpers for the background location task (lib/background-tasks.ts).
// Kept side-effect-free and dependency-free so they're directly unit
// testable without mocking expo-task-manager/Clerk/AsyncStorage.

export interface BackgroundLocationSample {
  coords: { latitude: number; longitude: number };
  timestamp: number;
}

// expo-location's background task typically appends `locations` oldest
// first, but that ordering isn't part of its documented contract -- pick
// explicitly by the highest `timestamp` instead of trusting array order.
// Ties resolve to the later element in the array.
export function pickLatestLocation<T extends BackgroundLocationSample>(
  locations: T[] | null | undefined,
): T | undefined {
  if (!locations || locations.length === 0) return undefined;
  return locations.reduce((latest, current) => (current.timestamp >= latest.timestamp ? current : latest));
}

// The response body from a rejected update could contain arbitrary
// server-controlled content -- this intentionally surfaces only the HTTP
// status, nothing else from the response.
export function locationUpdateRejectedMessage(status: number): string {
  return `[Location] Background update rejected by server (HTTP ${status})`;
}
