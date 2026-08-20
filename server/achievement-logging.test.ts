import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the review correction: a checkAndAwardAchievements
// failure used to be logged via `console.error("...", err)`, passing the
// raw Error object straight to the logger -- which could print
// error.message (SQL text, parameter values, addresses, tokens,
// credentials, whatever the failure happened to be holding). It must now
// log only a fixed stage label and the error's constructor name, mirroring
// server/_core/context.ts's logAuthFailure.
const mockGetPlayerInGame = vi.fn();
const mockExpirePlayerPowerUps = vi.fn();
const mockPurchasePowerUpAtomic = vi.fn();
const mockCheckAndAwardAchievements = vi.fn();

vi.mock("./db", () => ({
  getPlayerInGame: (...args: unknown[]) => mockGetPlayerInGame(...args),
  expirePlayerPowerUps: (...args: unknown[]) => mockExpirePlayerPowerUps(...args),
  purchasePowerUpAtomic: (...args: unknown[]) => mockPurchasePowerUpAtomic(...args),
  checkAndAwardAchievements: (...args: unknown[]) => mockCheckAndAwardAchievements(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(userId: number) {
  return { req: {} as never, res: {} as never, user: { id: userId, isSuperAdmin: false } as never, authError: null };
}

const SENSITIVE_MESSAGE = "ER_ACCESS_DENIED for user 'db_admin'@'10.0.0.7' (using password: YES) querying SELECT * FROM users WHERE token='sk_live_abc123'";

describe("achievement auto-detect failure logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlayerInGame.mockResolvedValue({ id: 5, gameId: 1 });
    mockExpirePlayerPowerUps.mockResolvedValue(undefined);
    mockPurchasePowerUpAtomic.mockResolvedValue({ inventoryId: 99, cost: 100 });
  });

  it("never logs the underlying error's message, only a fixed stage and the error's constructor name", async () => {
    mockCheckAndAwardAchievements.mockRejectedValue(new Error(SENSITIVE_MESSAGE));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = appRouter.createCaller(makeCtx(7));
    // The primary purchase still succeeds even though the achievement
    // side effect failed -- this is a best-effort check, not a blocker.
    await expect(caller.powerUp.purchase({ gameId: 1, powerUpId: 3 })).resolves.toEqual({
      success: true, inventoryId: 99, cost: 100, status: "inventory",
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = errorSpy.mock.calls[0];
    const loggedText = loggedArgs.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");

    expect(loggedText).not.toContain(SENSITIVE_MESSAGE);
    expect(loggedText).not.toContain("sk_live_abc123");
    expect(loggedText).not.toContain("db_admin");
    expect(loggedText).not.toContain("10.0.0.7");
    expect(loggedText).toContain("error class: Error");

    errorSpy.mockRestore();
  });

  it("still logs when the rejection isn't an Error instance, without ever including its content", async () => {
    mockCheckAndAwardAchievements.mockRejectedValue({ password: "hunter2", raw: SENSITIVE_MESSAGE });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = appRouter.createCaller(makeCtx(7));
    await caller.powerUp.purchase({ gameId: 1, powerUpId: 3 });

    const loggedText = errorSpy.mock.calls[0].map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
    expect(loggedText).not.toContain("hunter2");
    expect(loggedText).not.toContain(SENSITIVE_MESSAGE);

    errorSpy.mockRestore();
  });
});
