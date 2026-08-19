import { beforeEach, describe, expect, it, vi } from "vitest";

// Router-level coverage for game.assignTargets/clearTargets and the
// round/purge transition preconditions added to game.startRound/endRound/
// startPurge/endPurge -- mirrors server/rules-authorization.test.ts's
// approach: mock ./db, then drive the real router logic through
// appRouter.createCaller(). The underlying transactional correctness of
// assignTargetsAtomic/clearTargetsAtomic/startRoundAtomic is covered
// separately in server/db-targets.test.ts and server/db-start-round.test.ts;
// this file only proves the router's own auth checks and precondition
// gating (and that it delegates to those atomic functions rather than
// reimplementing anything itself).
const mockGetGame = vi.fn();
const mockAssignTargetsAtomic = vi.fn();
const mockClearTargetsAtomic = vi.fn();
const mockStartRoundAtomic = vi.fn();
const mockGetGamePlayers = vi.fn();
const mockGetActiveGamePowerUpsByName = vi.fn();
const mockCreateKillFeedEvent = vi.fn();
const mockUpdateGame = vi.fn();
const mockConsumePlayerPowerUp = vi.fn();
const mockPausePurgeSensitivePowerUps = vi.fn();
const mockResumePurgeSensitivePowerUps = vi.fn();
const mockCreateNotification = vi.fn();

vi.mock("./db", () => ({
  getGame: (...args: unknown[]) => mockGetGame(...args),
  assignTargetsAtomic: (...args: unknown[]) => mockAssignTargetsAtomic(...args),
  clearTargetsAtomic: (...args: unknown[]) => mockClearTargetsAtomic(...args),
  startRoundAtomic: (...args: unknown[]) => mockStartRoundAtomic(...args),
  getGamePlayers: (...args: unknown[]) => mockGetGamePlayers(...args),
  getActiveGamePowerUpsByName: (...args: unknown[]) => mockGetActiveGamePowerUpsByName(...args),
  createKillFeedEvent: (...args: unknown[]) => mockCreateKillFeedEvent(...args),
  updateGame: (...args: unknown[]) => mockUpdateGame(...args),
  consumePlayerPowerUp: (...args: unknown[]) => mockConsumePlayerPowerUp(...args),
  pausePurgeSensitivePowerUps: (...args: unknown[]) => mockPausePurgeSensitivePowerUps(...args),
  resumePurgeSensitivePowerUps: (...args: unknown[]) => mockResumePurgeSensitivePowerUps(...args),
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number, isSuperAdmin = false) {
  return { req: {} as never, res: {} as never, user: { id: userId, isSuperAdmin } as never, authError: null };
}

const BASE_GAME = { id: 1, adminId: 7, status: "active", deletedAt: null, purgeActive: false, roundEndTime: null, currentRound: 0, roundLength: 72 };

describe("game.assignTargets / game.clearTargets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockAssignTargetsAtomic.mockResolvedValue({ affected: 4 });
    mockClearTargetsAtomic.mockResolvedValue({ affected: 4 });
  });

  it("rejects a non-admin for assignTargets", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.assignTargets({ gameId: 1 })).rejects.toThrow("Admin access required");
    expect(mockAssignTargetsAtomic).not.toHaveBeenCalled();
  });

  it("allows the game's own admin for assignTargets and returns its result", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.assignTargets({ gameId: 1 })).resolves.toEqual({ affected: 4 });
    expect(mockAssignTargetsAtomic).toHaveBeenCalledWith(1);
  });

  it("allows a super admin for clearTargets even if they don't own the game", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7, true));
    await expect(caller.game.clearTargets({ gameId: 1 })).resolves.toEqual({ affected: 4 });
  });

  it("rejects a non-admin for clearTargets", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.clearTargets({ gameId: 1 })).rejects.toThrow("Admin access required");
    expect(mockClearTargetsAtomic).not.toHaveBeenCalled();
  });
});

describe("game.startRound preconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGame.mockResolvedValue(BASE_GAME);
    mockStartRoundAtomic.mockResolvedValue({ currentRound: 1, roundEndTime: new Date(), wildcardReturns: [] });
    mockGetGamePlayers.mockResolvedValue([]);
    mockGetActiveGamePowerUpsByName.mockResolvedValue([]);
  });

  it("rejects a non-admin", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99 });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.startRound({ gameId: 1 })).rejects.toThrow("Admin access required");
    expect(mockStartRoundAtomic).not.toHaveBeenCalled();
  });

  it("delegates entirely to startRoundAtomic for the actual preconditions/state change", async () => {
    const caller = appRouter.createCaller(makeCtx(7));
    await caller.game.startRound({ gameId: 1 });
    expect(mockStartRoundAtomic).toHaveBeenCalledWith(1);
    expect(mockCreateKillFeedEvent).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Round 1") }));
  });

  it("propagates a rejection from startRoundAtomic (e.g. round already active) without logging a kill feed event", async () => {
    mockStartRoundAtomic.mockRejectedValue(new Error("A round is already active"));
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.startRound({ gameId: 1 })).rejects.toThrow("already active");
    expect(mockCreateKillFeedEvent).not.toHaveBeenCalled();
  });

  // Wildcard swaps/consumption/returns now happen inside startRoundAtomic
  // itself -- the router's only remaining job for them is sending
  // notifications afterward, driven by what the transaction reports it
  // actually did (not by re-deriving it from a second, separate read).
  it("sends a Wildcard Returned notification for each owner startRoundAtomic reports, after the transaction has already committed", async () => {
    mockStartRoundAtomic.mockResolvedValue({ currentRound: 1, roundEndTime: new Date(), wildcardReturns: [{ ownerUserId: 42 }, { ownerUserId: 43 }] });
    const caller = appRouter.createCaller(makeCtx(7));
    await caller.game.startRound({ gameId: 1 });

    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, title: "Wildcard Returned" }));
    expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 43, title: "Wildcard Returned" }));
  });
});

describe("game.endRound preconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveGamePowerUpsByName.mockResolvedValue([]);
  });

  it("rejects ending a round when none is active", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, roundEndTime: null });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.endRound({ gameId: 1 })).rejects.toThrow("No round is currently active");
    expect(mockUpdateGame).not.toHaveBeenCalled();
  });

  it("allows ending an active round", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, roundEndTime: new Date(Date.now() + 60000) });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.endRound({ gameId: 1 })).resolves.toEqual({ success: true });
    expect(mockUpdateGame).toHaveBeenCalledWith(1, { roundEndTime: null });
  });

  it("rejects a non-admin regardless of round state", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, adminId: 99, roundEndTime: new Date() });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.endRound({ gameId: 1 })).rejects.toThrow("Admin access required");
  });
});

describe("game.startPurge preconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGamePlayers.mockResolvedValue([]);
  });

  it("rejects starting a purge on a deleted game", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, deletedAt: new Date() });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.startPurge({ gameId: 1, durationMinutes: 60 })).rejects.toThrow("deleted");
    expect(mockPausePurgeSensitivePowerUps).not.toHaveBeenCalled();
  });

  it("rejects starting a purge on a completed game", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, status: "completed" });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.startPurge({ gameId: 1, durationMinutes: 60 })).rejects.toThrow("already ended");
  });

  it("rejects starting an already-active purge", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, purgeActive: true });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.startPurge({ gameId: 1, durationMinutes: 60 })).rejects.toThrow("already active");
  });

  it("allows starting a purge when none is active", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, purgeActive: false });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.startPurge({ gameId: 1, durationMinutes: 60 })).resolves.toEqual({ success: true });
    expect(mockPausePurgeSensitivePowerUps).toHaveBeenCalledWith(1);
  });
});

describe("game.endPurge preconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGamePlayers.mockResolvedValue([]);
  });

  it("rejects ending a purge that isn't active", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, purgeActive: false });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.endPurge({ gameId: 1 })).rejects.toThrow("No purge is currently active");
    expect(mockResumePurgeSensitivePowerUps).not.toHaveBeenCalled();
  });

  it("allows ending an active purge", async () => {
    mockGetGame.mockResolvedValue({ ...BASE_GAME, purgeActive: true });
    const caller = appRouter.createCaller(makeCtx(7));
    await expect(caller.game.endPurge({ gameId: 1 })).resolves.toEqual({ success: true });
    expect(mockResumePurgeSensitivePowerUps).toHaveBeenCalledWith(1);
  });
});
