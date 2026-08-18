import { beforeEach, describe, expect, it, vi } from "vitest";

// rules.create and rules.update previously had no admin check at all --
// any authenticated user could add or toggle rules for any game. Mocking
// ./db (the same pattern server/_core/context.test.ts uses) lets the real
// router logic run against controlled game/rule rows without a database.
const mockGetGame = vi.fn();
const mockCreateRule = vi.fn();
const mockGetRule = vi.fn();
const mockUpdateRule = vi.fn();
const mockSeedStandardRules = vi.fn();

vi.mock("./db", () => ({
  getGame: (...args: unknown[]) => mockGetGame(...args),
  createRule: (...args: unknown[]) => mockCreateRule(...args),
  getRule: (...args: unknown[]) => mockGetRule(...args),
  updateRule: (...args: unknown[]) => mockUpdateRule(...args),
  seedStandardRules: (...args: unknown[]) => mockSeedStandardRules(...args),
}));

const { appRouter } = await import("./routers");

function makeCtx(user: { id: number; isSuperAdmin?: boolean } | null) {
  return { req: {} as never, res: {} as never, user: user as never, authError: null };
}

describe("rules router authorization", () => {
  beforeEach(() => {
    mockGetGame.mockReset();
    mockCreateRule.mockReset();
    mockGetRule.mockReset();
    mockUpdateRule.mockReset();
    mockSeedStandardRules.mockReset();
  });

  describe("rules.create", () => {
    it("rejects a user who is not this game's admin", async () => {
      mockGetGame.mockResolvedValue({ id: 1, adminId: 99, gameType: "last_man_standing" });
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.create({ gameId: 1, ruleText: "No running" })).rejects.toThrow("Admin access required");
      expect(mockCreateRule).not.toHaveBeenCalled();
    });

    it("allows the game's own admin", async () => {
      mockGetGame.mockResolvedValue({ id: 1, adminId: 7, gameType: "last_man_standing" });
      mockCreateRule.mockResolvedValue(42);
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.create({ gameId: 1, ruleText: "No running" })).resolves.toEqual({ id: 42 });
    });

    it("allows a super admin who isn't this game's own admin", async () => {
      mockGetGame.mockResolvedValue({ id: 1, adminId: 99, gameType: "last_man_standing" });
      mockCreateRule.mockResolvedValue(43);
      const caller = appRouter.createCaller(makeCtx({ id: 7, isSuperAdmin: true }));

      await expect(caller.rules.create({ gameId: 1, ruleText: "No running" })).resolves.toEqual({ id: 43 });
    });

    it("rejects when the game does not exist", async () => {
      mockGetGame.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.create({ gameId: 999, ruleText: "x" })).rejects.toThrow("Admin access required");
      expect(mockCreateRule).not.toHaveBeenCalled();
    });
  });

  describe("rules.update", () => {
    it("rejects a user who is not the owning game's admin", async () => {
      mockGetRule.mockResolvedValue({ id: 5, gameId: 1, ruleText: "x" });
      mockGetGame.mockResolvedValue({ id: 1, adminId: 99 });
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.update({ id: 5, isEnabled: false })).rejects.toThrow("Admin access required");
      expect(mockUpdateRule).not.toHaveBeenCalled();
    });

    it("allows the owning game's admin", async () => {
      mockGetRule.mockResolvedValue({ id: 5, gameId: 1, ruleText: "x" });
      mockGetGame.mockResolvedValue({ id: 1, adminId: 7 });
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.update({ id: 5, isEnabled: false })).resolves.toEqual({ success: true });
      expect(mockUpdateRule).toHaveBeenCalledWith(5, { isEnabled: false });
    });

    it("rejects when the rule does not exist, without ever loading a game", async () => {
      mockGetRule.mockResolvedValue(undefined);
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.update({ id: 404, isEnabled: false })).rejects.toThrow("Rule not found");
      expect(mockGetGame).not.toHaveBeenCalled();
      expect(mockUpdateRule).not.toHaveBeenCalled();
    });
  });

  describe("rules.seedStandard", () => {
    it("rejects a user who is not this game's admin", async () => {
      mockGetGame.mockResolvedValue({ id: 1, adminId: 99, gameType: "last_man_standing" });
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.seedStandard({ gameId: 1 })).rejects.toThrow("Admin access required");
      expect(mockSeedStandardRules).not.toHaveBeenCalled();
    });

    it("looks up the standard-rule set matching the game's own type and delegates to db.seedStandardRules", async () => {
      mockGetGame.mockResolvedValue({ id: 1, adminId: 7, gameType: "teams" });
      mockSeedStandardRules.mockResolvedValue({ created: 7, skipped: 0, total: 7 });
      const caller = appRouter.createCaller(makeCtx({ id: 7 }));

      await expect(caller.rules.seedStandard({ gameId: 1 })).resolves.toEqual({ created: 7, skipped: 0, total: 7 });
      expect(mockSeedStandardRules).toHaveBeenCalledWith(1, expect.arrayContaining(["Teams of 2 players each"]));
    });

    it("allows a super admin to seed a game they don't own", async () => {
      mockGetGame.mockResolvedValue({ id: 1, adminId: 99, gameType: "highest_points" });
      mockSeedStandardRules.mockResolvedValue({ created: 8, skipped: 0, total: 8 });
      const caller = appRouter.createCaller(makeCtx({ id: 7, isSuperAdmin: true }));

      await expect(caller.rules.seedStandard({ gameId: 1 })).resolves.toEqual({ created: 8, skipped: 0, total: 8 });
    });
  });
});
