import { eq, and, desc, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, games, gamePlayers, powerUps, eliminations, chatMessages, achievements, playerAchievements, playerPowerUps, gameRules, killFeed, mapPowerUps, mapPowerUpGuesses, teams, bounties, notifications, rouletteOutcomes } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
    // Owner is always super admin
    (values as any).isSuperAdmin = true;
    updateSet.isSuperAdmin = true;
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function makeSuperAdmin(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ isSuperAdmin: true, role: "admin" } as any).where(eq(users.id, userId));
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ===== GAME QUERIES =====

export async function createGame(data: typeof games.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Generate a unique join code
  const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const result = await db.insert(games).values({ ...data, joinCode });
  return result[0].insertId;
}

export async function getGame(gameId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  return result[0];
}

export async function getGameByJoinCode(joinCode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(games).where(eq(games.joinCode, joinCode)).limit(1);
  return result[0];
}

export async function getUserGames(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const playerGames = await db.select().from(gamePlayers).where(eq(gamePlayers.userId, userId));
  if (playerGames.length === 0) return [];
  const gameIds = playerGames.map(p => p.gameId);
  const allGames = await db.select().from(games);
  return allGames.filter(g => gameIds.includes(g.id));
}

export async function getAdminGames(adminId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(games).where(eq(games.adminId, adminId));
}

export async function updateGame(gameId: number, data: Partial<typeof games.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(games).set(data).where(eq(games.id, gameId));
}

// ===== PLAYER QUERIES =====

export async function joinGame(data: typeof gamePlayers.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get game to set starting points
  const game = await getGame(data.gameId);
  const startingPoints = game?.startingPoints || 0;
  const result = await db.insert(gamePlayers).values({ ...data, points: startingPoints });
  return result[0].insertId;
}

export async function getGamePlayers(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const userIds = players.map(p => p.userId);
  const allUsers = await db.select().from(users);
  const userMap = Object.fromEntries(allUsers.filter(u => userIds.includes(u.id)).map(u => [u.id, u]));
  return players.map(p => ({ ...p, user: userMap[p.userId] }));
}

export async function getPlayerInGame(gameId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(gamePlayers).where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId))).limit(1);
  return result[0];
}

export async function getPlayerById(playerId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(gamePlayers).where(eq(gamePlayers.id, playerId)).limit(1);
  return result[0] ?? null;
}

export async function updatePlayer(playerId: number, data: Partial<typeof gamePlayers.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(gamePlayers).set(data).where(eq(gamePlayers.id, playerId));
}

export async function getLeaderboard(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId)).orderBy(desc(gamePlayers.points));
  const userIds = players.map(p => p.userId);
  const allUsers = await db.select().from(users);
  const userMap = Object.fromEntries(allUsers.filter(u => userIds.includes(u.id)).map(u => [u.id, u]));
  return players.map((p, i) => ({ ...p, rank: i + 1, user: userMap[p.userId] }));
}

// ===== BOUNTY QUERIES =====

export async function createBounty(data: typeof bounties.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(bounties).values(data);
  // Update player bounty totals
  const allBounties = await db.select().from(bounties).where(and(eq(bounties.targetPlayerId, data.targetPlayerId), eq(bounties.isActive, true)));
  const totalPoints = allBounties.reduce((sum, b) => sum + b.amount, 0);
  await db.update(gamePlayers).set({ bountyPoints: totalPoints, bountyCount: allBounties.length }).where(eq(gamePlayers.id, data.targetPlayerId));
  return result[0].insertId;
}

export async function getGameBounties(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bounties).where(and(eq(bounties.gameId, gameId), eq(bounties.isActive, true)));
}

export async function getBountyBoard(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const withBounties = players.filter(p => (p.bountyPoints || 0) > 0);
  const userIds = withBounties.map(p => p.userId);
  const allUsers = await db.select().from(users);
  const userMap = Object.fromEntries(allUsers.filter(u => userIds.includes(u.id)).map(u => [u.id, u]));
  return withBounties
    .sort((a, b) => (b.bountyPoints || 0) - (a.bountyPoints || 0))
    .map(p => ({ playerId: p.id, playerName: userMap[p.userId]?.name || "Unknown", bountyCount: p.bountyCount || 0, bountyPoints: p.bountyPoints || 0 }));
}

export async function claimBounties(gameId: number, targetPlayerId: number, claimedByPlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bounties).set({ isActive: false, claimedByPlayerId }).where(and(eq(bounties.gameId, gameId), eq(bounties.targetPlayerId, targetPlayerId), eq(bounties.isActive, true)));
  await db.update(gamePlayers).set({ bountyPoints: 0, bountyCount: 0 }).where(eq(gamePlayers.id, targetPlayerId));
}

// ===== POWER-UP QUERIES =====

export async function createPowerUp(data: typeof powerUps.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(powerUps).values(data);
  return result[0].insertId;
}

export async function getGamePowerUps(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(powerUps).where(eq(powerUps.gameId, gameId));
}

export async function updatePowerUp(id: number, data: Partial<typeof powerUps.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(powerUps).set(data).where(eq(powerUps.id, id));
}

export async function purchasePowerUp(gamePlayerId: number, powerUpId: number, gameId: number, expiresAt: Date | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(playerPowerUps).values({ gamePlayerId, powerUpId, gameId, isActive: true, expiresAt });
}

export async function getPlayerPowerUps(gamePlayerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(playerPowerUps).where(and(eq(playerPowerUps.gamePlayerId, gamePlayerId), eq(playerPowerUps.isActive, true)));
}

// ===== ELIMINATION QUERIES =====

export async function createElimination(data: typeof eliminations.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(eliminations).values(data);
  return result[0].insertId;
}

export async function getPendingEliminations(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(eliminations).where(and(eq(eliminations.gameId, gameId), eq(eliminations.status, "pending")));
}

export async function updateElimination(id: number, data: Partial<typeof eliminations.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(eliminations).set(data).where(eq(eliminations.id, id));
}

export async function getElimination(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(eliminations).where(eq(eliminations.id, id)).limit(1);
  return result[0];
}

// ===== CHAT QUERIES =====

export async function createChatMessage(data: typeof chatMessages.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(chatMessages).values(data);
  return result[0].insertId;
}

export async function getGameChat(gameId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const messages = await db.select().from(chatMessages).where(eq(chatMessages.gameId, gameId)).orderBy(desc(chatMessages.createdAt)).limit(limit);
  const userIds = [...new Set(messages.map(m => m.userId))];
  const allUsers = await db.select().from(users);
  const userMap = Object.fromEntries(allUsers.filter(u => userIds.includes(u.id)).map(u => [u.id, u]));
  return messages.map(m => ({ ...m, user: userMap[m.userId] }));
}

// ===== ACHIEVEMENT QUERIES =====

export async function createAchievement(data: typeof achievements.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(achievements).values(data);
  return result[0].insertId;
}

export async function getGameAchievements(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(achievements).where(eq(achievements.gameId, gameId));
}

export async function awardAchievement(gamePlayerId: number, achievementId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(playerAchievements).values({ gamePlayerId, achievementId });
}

export async function getPlayerAchievements(gamePlayerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(playerAchievements).where(eq(playerAchievements.gamePlayerId, gamePlayerId));
}

// ===== RULES QUERIES =====

export async function createRule(data: typeof gameRules.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(gameRules).values(data);
  return result[0].insertId;
}

export async function getGameRules(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(gameRules).where(eq(gameRules.gameId, gameId));
}

export async function updateRule(id: number, data: Partial<typeof gameRules.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(gameRules).set(data).where(eq(gameRules.id, id));
}

// ===== KILL FEED QUERIES =====

export async function createKillFeedEvent(data: typeof killFeed.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(killFeed).values(data);
}

export async function getKillFeed(gameId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(killFeed).where(eq(killFeed.gameId, gameId)).orderBy(desc(killFeed.createdAt)).limit(limit);
}

// ===== MAP POWER-UP QUERIES =====

export async function createMapPowerUp(data: typeof mapPowerUps.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(mapPowerUps).values(data);
  return result[0].insertId;
}

export async function getMapPowerUps(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mapPowerUps).where(eq(mapPowerUps.gameId, gameId));
}

export async function claimMapPowerUp(id: number, playerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(mapPowerUps).set({ claimedBy: playerId }).where(eq(mapPowerUps.id, id));
}

// ===== TEAM QUERIES =====

export async function createTeam(data: typeof teams.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teams).values(data);
  return result[0].insertId;
}

export async function getGameTeams(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(teams).where(eq(teams.gameId, gameId));
}

// ===== NOTIFICATION QUERIES =====

export async function createNotification(data: typeof notifications.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(notifications).values(data);
}

export async function getUserNotifications(userId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function markNotificationRead(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, userId));
}

// ===== ROULETTE QUERIES =====

export async function createRouletteOutcome(data: typeof rouletteOutcomes.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(rouletteOutcomes).values(data);
  return result[0].insertId;
}

export async function getRouletteOutcomes(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rouletteOutcomes).where(eq(rouletteOutcomes.gameId, gameId));
}

export async function updateRouletteOutcome(id: number, data: Partial<typeof rouletteOutcomes.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(rouletteOutcomes).set(data).where(eq(rouletteOutcomes.id, id));
}

export async function deleteRouletteOutcome(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(rouletteOutcomes).where(eq(rouletteOutcomes.id, id));
}

// ===== ACHIEVEMENT AUTO-DETECTION =====

/**
 * Evaluate and auto-award achievements for a player based on their current stats.
 * Called after any significant game event (elimination, purchase, bounty, purge, etc.)
 */
export async function checkAndAwardAchievements(gamePlayerId: number, gameId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Get player stats
    const playerRows = await db.select().from(gamePlayers).where(eq(gamePlayers.id, gamePlayerId)).limit(1);
    if (!playerRows.length) return;
    const player = playerRows[0];

    // Get all game achievements
    const allAchievements = await db.select().from(achievements).where(eq(achievements.gameId, gameId));
    if (!allAchievements.length) return;

    // Get already awarded achievements for this player
    const alreadyAwarded = await db.select().from(playerAchievements).where(eq(playerAchievements.gamePlayerId, gamePlayerId));
    const awardedIds = new Set(alreadyAwarded.map(a => a.achievementId));

    // Get purchase counts for this player
    const purchases = await db.select().from(playerPowerUps).where(eq(playerPowerUps.gamePlayerId, gamePlayerId));
    const totalPurchased = purchases.length;

    // Get all eliminations for this player as eliminator (approved)
    const elimsAsKiller = await db.select().from(eliminations)
      .where(and(eq(eliminations.eliminatorId, gamePlayerId), eq(eliminations.status, "approved")));
    const gameKills = elimsAsKiller.length;
    const kills = player.kills || 0;

    // Get bounties placed by this player
    const bountiesPlaced = await db.select().from(bounties)
      .where(and(eq(bounties.placedByPlayerId, gamePlayerId)));
    const bountiesPlacedCount = bountiesPlaced.length;

    // Get bounties collected (claimed) by this player
    const bountiesCollected = await db.select().from(bounties)
      .where(and(eq(bounties.claimedByPlayerId, gamePlayerId)));
    const bountiesCollectedCount = bountiesCollected.length;

    // Get power-up categories purchased
    const purchasedPowerUpIds = purchases.map(p => p.powerUpId);
    let defensivePurchased = 0;
    let chaosPurchased = 0;
    if (purchasedPowerUpIds.length > 0) {
      const allPowerUps = await db.select().from(powerUps).where(eq(powerUps.gameId, gameId));
      const purchasedPUs = allPowerUps.filter(pu => purchasedPowerUpIds.includes(pu.id));
      defensivePurchased = purchasedPUs.filter(pu => pu.category === "defensive").length;
      chaosPurchased = purchasedPUs.filter(pu => pu.category === "chaos").length;
    }

    // Build stats map for condition evaluation
    const stats: Record<string, number | boolean> = {
      lifetime_eliminations: kills,
      game_eliminations: gameKills,
      game_powerups_purchased: totalPurchased,
      game_powerups_used: totalPurchased,
      game_bounties_placed: bountiesPlacedCount,
      game_bounties_collected: bountiesCollectedCount,
      game_defensive_powerups: defensivePurchased,
      game_chaos_powerups: chaosPurchased,
      game_kill_streak: kills, // simplified: use total kills as streak proxy
    };

    // Check each achievement condition
    for (const achievement of allAchievements) {
      if (awardedIds.has(achievement.id)) continue; // already earned
      if (!achievement.condition) continue;

      const condition = achievement.condition;
      let earned = false;

      // Parse conditions like "lifetime_eliminations >= 1"
      const match = condition.match(/^(\w+)\s*(>=|<=|==|>|<)\s*(\d+)$/);
      if (match) {
        const [, key, op, valStr] = match;
        const statVal = stats[key];
        const threshold = parseInt(valStr);
        if (typeof statVal === "number") {
          if (op === ">=" && statVal >= threshold) earned = true;
          else if (op === ">" && statVal > threshold) earned = true;
          else if (op === "<=" && statVal <= threshold) earned = true;
          else if (op === "<" && statVal < threshold) earned = true;
          else if (op === "==" && statVal === threshold) earned = true;
        }
      }

      if (earned) {
        try {
          await db.insert(playerAchievements).values({ gamePlayerId, achievementId: achievement.id });
          // Award points to player
          if (achievement.pointsValue && achievement.pointsValue > 0) {
            await db.update(gamePlayers)
              .set({ points: (player.points || 0) + achievement.pointsValue })
              .where(eq(gamePlayers.id, gamePlayerId));
          }
          // Create kill feed event
          await db.insert(killFeed).values({
            gameId,
            eventType: "achievement_earned",
            actorId: gamePlayerId,
            message: `${achievement.emoji || "🏅"} ${player.userId ? "A player" : "Player"} earned "${achievement.name}"! +${achievement.pointsValue || 0} pts`,
          });
          // Notify player
          await db.insert(notifications).values({
            userId: player.userId,
            gameId,
            type: "achievement_earned",
            title: `🏅 Achievement Unlocked!`,
            body: `${achievement.emoji || "🏅"} ${achievement.name}: ${achievement.description || ""}`,
          });
        } catch (e) {
          // Ignore duplicate key errors (already awarded race condition)
        }
      }
    }
  } catch (e) {
    console.error("[Achievements] Auto-detect error:", e);
  }
}

export async function createMapPowerUpGuess(data: {
  mapPowerUpId: number;
  gamePlayerId: number;
  guessLatitude: string;
  guessLongitude: string;
  distanceMeters: number;
  isCorrect: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(mapPowerUpGuesses).values({
    mapPowerUpId: data.mapPowerUpId,
    gamePlayerId: data.gamePlayerId,
    guessLatitude: data.guessLatitude,
    guessLongitude: data.guessLongitude,
    distanceMeters: data.distanceMeters,
    isCorrect: data.isCorrect,
  });
}

export async function getCompletedGames(userId: number) {
  const db = await getDb();
  if (!db) return [];
  // Get all games where user is a player
  const playerGames = await db.select().from(gamePlayers).where(eq(gamePlayers.userId, userId));
  const playerGameIds = playerGames.map(p => p.gameId);
  // Get all games where user is admin
  const adminGamesList = await db.select().from(games).where(eq(games.adminId, userId));
  const adminGameIds = adminGamesList.map(g => g.id);
  // Combine unique game IDs
  const allGameIds = Array.from(new Set([...playerGameIds, ...adminGameIds]));
  if (allGameIds.length === 0) return [];
  // Fetch all those games and filter to completed
  const allGames = await db.select().from(games);
  const completedGames = allGames.filter(g => allGameIds.includes(g.id) && g.status === "completed");
  // For each completed game, attach the user's player record (if any)
  const playerMap = Object.fromEntries(playerGames.map(p => [p.gameId, p]));
  return completedGames
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(g => ({ ...g, myPlayer: playerMap[g.id] ?? null }));
}
