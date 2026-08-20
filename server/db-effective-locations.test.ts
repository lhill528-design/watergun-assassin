import { beforeEach, describe, expect, it, vi } from "vitest";
import { playerPowerUps, powerUps } from "../drizzle/schema";

// computeEffectiveLocations is the single pipeline player.list and
// player.checkLocation both delegate to for Blackout/Dead Zone/Witness
// Protection/Burner Phone hiding, Doppelganger swaps, and Decoy
// substitution. This mocks the driver modules underneath server/db.ts so
// the real pipeline runs against fake playerPowerUps/powerUps tables,
// proving the transformation logic itself (not the router wiring, which
// is covered separately).
function matchesCondition(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond) return true;
  const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks;
  const maybeColumn = chunks?.[1] as { name?: string; queryChunks?: unknown[] } | undefined;
  if (maybeColumn && typeof maybeColumn.name === "string") {
    const value = (chunks?.[3] as { value?: unknown } | undefined)?.value;
    return row[maybeColumn.name] === value;
  }
  if (maybeColumn && Array.isArray(maybeColumn.queryChunks)) {
    const pairs = maybeColumn.queryChunks
      .filter((c): c is { queryChunks: unknown[] } => !!(c as any)?.queryChunks)
      .map((c) => {
        const inner = c.queryChunks;
        return { column: (inner[1] as { name?: string })?.name, value: (inner[3] as { value?: unknown })?.value };
      });
    return pairs.every((p) => row[p.column as string] === p.value);
  }
  return true;
}

let playerPowerUpRows: Array<Record<string, unknown>>;
let powerUpCatalog: Array<Record<string, unknown>>;

function resetFakeState() {
  playerPowerUpRows = [];
  powerUpCatalog = [
    { id: 1, gameId: 1, name: "Radar" },
    { id: 2, gameId: 1, name: "Vendetta" },
    { id: 3, gameId: 1, name: "Dead Zone" },
    { id: 4, gameId: 1, name: "Witness Protection" },
    { id: 5, gameId: 1, name: "Burner Phone" },
    { id: 6, gameId: 1, name: "Decoy" },
    { id: 7, gameId: 1, name: "Doppelganger" },
    { id: 8, gameId: 1, name: "Sanctuary" },
    { id: 9, gameId: 1, name: "Blackout" },
  ];
}
resetFakeState();

const fakeDb = {
  select: vi.fn((_fields?: unknown) => {
    const local = { table: null as unknown };
    const builder: any = {
      from: (table: unknown) => { local.table = table; return builder; },
      where: (cond: unknown) => { builder.__cond = cond; return builder; },
      __cond: undefined as unknown,
      then: (resolve: (value: unknown) => void) => {
        const rows = local.table === playerPowerUps ? playerPowerUpRows : local.table === powerUps ? powerUpCatalog : [];
        resolve(rows.filter((row) => matchesCondition(row, builder.__cond)).map((row) => ({ ...row })));
      },
    };
    return builder;
  }),
};

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => fakeDb),
}));

vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({})),
}));

const { computeEffectiveLocations } = await import("./db");

const FIXTURE_DATABASE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

// Viewer (1) hunts target (2). Bystanders 3, 4 exist for Doppelganger and
// Blackout scenarios.
function fourPlayers() {
  return [
    { id: 1, userId: 101, latitude: "1.000000", longitude: "1.000000", targetId: 2 },
    { id: 2, userId: 102, latitude: "2.000000", longitude: "2.000000", targetId: 3 },
    { id: 3, userId: 103, latitude: "3.000000", longitude: "3.000000", targetId: 4 },
    { id: 4, userId: 104, latitude: "4.000000", longitude: "4.000000", targetId: 1 },
  ];
}
const viewer = { id: 1, targetId: 2 };
const noOptions = { purgeActive: false, showLocationsDuringPurge: false };

describe("computeEffectiveLocations", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = FIXTURE_DATABASE_URL;
    resetFakeState();
  });

  it("substitutes an active Decoy's coordinates for the target's real ones", async () => {
    playerPowerUpRows = [
      {
        id: 501, gameId: 1, gamePlayerId: 2, powerUpId: 6, status: "active", isActive: true, expiresAt: null,
        activationData: { decoyLatitude: "9.999999", decoyLongitude: "9.999999" },
      },
    ];
    const players = fourPlayers();
    const result = await computeEffectiveLocations(1, players, viewer, noOptions);

    expect(result.locationsByPlayerId.get(2)).toEqual({ latitude: "9.999999", longitude: "9.999999" });
    expect(result.hiddenIds.has(2)).toBe(false); // decoy is a substitution, not a hide
  });

  it("swaps two players' coordinates for an active Doppelganger pair", async () => {
    playerPowerUpRows = [
      { id: 502, gameId: 1, gamePlayerId: 3, powerUpId: 7, status: "active", isActive: true, expiresAt: null, targetPlayerId: 4, activatedAt: new Date() },
    ];
    // Viewer needs Radar (or purge) to see bystanders 3/4 at all, since
    // neither is the viewer's direct target.
    playerPowerUpRows.push({ id: 503, gameId: 1, gamePlayerId: 1, powerUpId: 1, status: "active", isActive: true, expiresAt: null });
    const players = fourPlayers();
    const result = await computeEffectiveLocations(1, players, viewer, noOptions);

    expect(result.locationsByPlayerId.get(3)).toEqual({ latitude: "4.000000", longitude: "4.000000" });
    expect(result.locationsByPlayerId.get(4)).toEqual({ latitude: "3.000000", longitude: "3.000000" });
  });

  it("hides every player's location under a game-wide Blackout, with no bypass", async () => {
    playerPowerUpRows = [
      { id: 504, gameId: 1, gamePlayerId: 3, powerUpId: 9, status: "active", isActive: true, expiresAt: null }, // Blackout owner is irrelevant -- it's game-wide
    ];
    const players = fourPlayers();
    const result = await computeEffectiveLocations(1, players, viewer, noOptions);

    expect(result.hiddenIds.has(2)).toBe(true); // even the viewer's own direct target
    expect(result.locationsByPlayerId.get(2)).toEqual({ latitude: null, longitude: null });
  });

  it("hides a target protected by Dead Zone even though they are the viewer's direct target", async () => {
    playerPowerUpRows = [
      { id: 505, gameId: 1, gamePlayerId: 2, powerUpId: 3, status: "active", isActive: true, expiresAt: null },
    ];
    const players = fourPlayers();
    const result = await computeEffectiveLocations(1, players, viewer, noOptions);

    expect(result.hiddenIds.has(2)).toBe(true);
    expect(result.locationsByPlayerId.get(2)).toEqual({ latitude: null, longitude: null });
  });
});
