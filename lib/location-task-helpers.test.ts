import { describe, expect, it } from "vitest";
import { locationUpdateRejectedMessage, pickLatestLocation } from "./location-task-helpers";

describe("pickLatestLocation", () => {
  it("returns undefined for null/undefined/empty input", () => {
    expect(pickLatestLocation(null)).toBeUndefined();
    expect(pickLatestLocation(undefined)).toBeUndefined();
    expect(pickLatestLocation([])).toBeUndefined();
  });

  it("returns the only element for a single-item batch", () => {
    const location = { coords: { latitude: 1, longitude: 2 }, timestamp: 100 };
    expect(pickLatestLocation([location])).toBe(location);
  });

  it("picks the highest-timestamp element regardless of array order", () => {
    const oldest = { coords: { latitude: 1, longitude: 1 }, timestamp: 100 };
    const newest = { coords: { latitude: 3, longitude: 3 }, timestamp: 300 };
    const middle = { coords: { latitude: 2, longitude: 2 }, timestamp: 200 };

    // Oldest-first (expo-location's typical append order)
    expect(pickLatestLocation([oldest, middle, newest])).toBe(newest);
    // Out of order
    expect(pickLatestLocation([newest, oldest, middle])).toBe(newest);
  });

  it("does not fall back to array-position for a batch with a single later reading inserted first", () => {
    const newest = { coords: { latitude: 9, longitude: 9 }, timestamp: 500 };
    const older = { coords: { latitude: 1, longitude: 1 }, timestamp: 50 };
    expect(pickLatestLocation([newest, older])).toBe(newest);
  });
});

describe("locationUpdateRejectedMessage", () => {
  it("includes the HTTP status and nothing else server-controlled", () => {
    expect(locationUpdateRejectedMessage(401)).toBe("[Location] Background update rejected by server (HTTP 401)");
    expect(locationUpdateRejectedMessage(500)).toContain("500");
  });
});
