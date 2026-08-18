import { eq, and, desc, asc, sql, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool, type PoolOptions } from "mysql2/promise";
import { InsertUser, users, games, gamePlayers, powerUps, eliminations, achievements, playerAchievements, playerPowerUps, powerUpUsageFees, gameRules, killFeed, mapPowerUps, mapPowerUpGuesses, teams, bounties, notifications, rouletteOutcomes, duels, chatMessages } from "../drizzle/schema";
import { ENV } from "./_core/env";

const SUPER_ADMIN_EMAILS = ["lhill528@gmail.com", "lhill29@comcast.net"];

export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

// Manual parsing (rather than handing the raw string straight to mysql2)
// so host/port/user/password/database are all explicit values under our
// control before TLS options -- which the connection string itself cannot
// express safely -- get merged in. `new URL()` leaves username/password as
// still percent-encoded exactly as written in the string, so they're
// decoded here rather than left for mysql2 to receive un-decoded.
export function parseDatabaseUrl(databaseUrl: string): DatabaseConnectionConfig {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("DATABASE_URL is missing a database name");
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

// TLS is fixed here, not sourced from the URL's own query string (e.g. a
// `ssl-mode=...` param) -- TiDB's proxy returns a generic
// ER_UNKNOWN_ERROR/1105 for plain, non-TLS mysql2 connections, and this is
// the exact explicit configuration confirmed to work in production
// diagnosis. rejectUnauthorized must never be false: that would accept any
// certificate, defeating the point of requiring TLS at all.
export function buildPoolOptions(databaseUrl: string): PoolOptions {
  const config = parseDatabaseUrl(databaseUrl);
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  };
}

function createDatabasePool(databaseUrl: string): Pool {
  return createPool(buildPoolOptions(databaseUrl));
}

// Named (rather than inlining `drizzle(createDatabasePool(...))` at the
// call site) so `_db`'s type can be inferred from this specific call --
// passing a mysql2/promise Pool in, as opposed to letting drizzle() infer
// its default (callback-style) client type from a bare connection string
// -- which is exactly the client shape drizzle-orm/mysql2 requires here.
function createDrizzleClient(databaseUrl: string) {
  return drizzle(createDatabasePool(databaseUrl));
}

// Never includes the error's own message -- a driver error can echo back
// connection details (e.g. a malformed-URL TypeError includes the
// offending string verbatim), so only a fixed stage label and the error's
// class name are logged.
function logConnectionFailure(stage: string, error: unknown): void {
  const errorClass = error instanceof Error ? error.constructor.name : typeof error;
  console.warn(`[Database] connection failed (stage=${stage}, errorClass=${errorClass})`);
}

let _db: ReturnType<typeof createDrizzleClient> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = createDrizzleClient(process.env.DATABASE_URL);
    } catch (error) {
      logConnectionFailure("connection-init", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.clerkId) throw new Error("User clerkId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { clerkId: user.clerkId };
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
  if (user.clerkId === ENV.ownerClerkId || (!!user.email && SUPER_ADMIN_EMAILS.includes(user.email.toLowerCase()))) {
    values.role = "admin";
    updateSet.role = "admin";
    (values as any).isSuperAdmin = true;
    updateSet.isSuperAdmin = true;
  } else if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
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

export async function getUserByClerkId(clerkId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserDisplayName(userId: number, displayName: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ displayName }).where(eq(users.id, userId));
}

// ===== GAME QUERIES =====

// Creates the game and adds its admin as the game's first player in a
// single transaction. These used to be two separate calls (createGame()
// then joinGame()) issued back to back from the game.create mutation; if
// the second one failed for any reason, the first had already committed,
// leaving an orphaned game row with no players and no way for the admin
// who "created" it to ever see it again as theirs. Committing or rolling
// back both together closes that gap.
export async function createGameWithAdmin(
  data: typeof games.$inferInsert,
): Promise<{ gameId: number; playerId: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Generate a unique join code
  const joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  return db.transaction(async (tx) => {
    const gameResult = await tx.insert(games).values({ ...data, joinCode });
    const gameId = gameResult[0].insertId;
    const playerResult = await tx.insert(gamePlayers).values({
      gameId,
      userId: data.adminId,
      points: data.startingPoints || 0,
    });
    return { gameId, playerId: playerResult[0].insertId };
  });
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
  return allGames.filter(g => gameIds.includes(g.id) && g.status !== "completed" && !g.deletedAt);
}

export async function getAdminGames(adminId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(games).where(and(eq(games.adminId, adminId), isNull(games.deletedAt)));
}

export async function deleteGamePermanently(gameId: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const players = await database.select({ id: gamePlayers.id }).from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const playerIds = players.map(player => player.id);
  const inventory = await database.select({ id: playerPowerUps.id }).from(playerPowerUps).where(eq(playerPowerUps.gameId, gameId));
  const inventoryIds = inventory.map(item => item.id);
  const placed = await database.select({ id: mapPowerUps.id }).from(mapPowerUps).where(eq(mapPowerUps.gameId, gameId));
  const mapIds = placed.map(item => item.id);
  for (const mapId of mapIds) await database.delete(mapPowerUpGuesses).where(eq(mapPowerUpGuesses.mapPowerUpId, mapId));
  for (const inventoryId of inventoryIds) await database.delete(powerUpUsageFees).where(eq(powerUpUsageFees.playerPowerUpId, inventoryId));
  for (const playerId of playerIds) await database.delete(playerAchievements).where(eq(playerAchievements.gamePlayerId, playerId));
  await database.delete(playerPowerUps).where(eq(playerPowerUps.gameId, gameId));
  await database.delete(powerUpUsageFees).where(eq(powerUpUsageFees.gameId, gameId));
  await database.delete(eliminations).where(eq(eliminations.gameId, gameId));
  await database.delete(bounties).where(eq(bounties.gameId, gameId));
  await database.delete(duels).where(eq(duels.gameId, gameId));
  await database.delete(mapPowerUps).where(eq(mapPowerUps.gameId, gameId));
  await database.delete(killFeed).where(eq(killFeed.gameId, gameId));
  await database.delete(chatMessages).where(eq(chatMessages.gameId, gameId));
  await database.delete(notifications).where(eq(notifications.gameId, gameId));
  await database.delete(rouletteOutcomes).where(eq(rouletteOutcomes.gameId, gameId));
  await database.delete(gameRules).where(eq(gameRules.gameId, gameId));
  await database.delete(achievements).where(eq(achievements.gameId, gameId));
  await database.delete(teams).where(eq(teams.gameId, gameId));
  await database.delete(powerUps).where(eq(powerUps.gameId, gameId));
  await database.delete(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  await database.delete(games).where(eq(games.id, gameId));
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

export async function repairTargetChainAfterRevive(gameId: number, revivedPlayerId: number) {
  const revived = await getPlayerById(revivedPlayerId);
  if (!revived?.targetId) return;
  const players = await getGamePlayers(gameId);
  const currentHunter = players.find(player => player.id !== revivedPlayerId && player.targetId === revived.targetId && player.status === "alive");
  if (currentHunter) await updatePlayer(currentHunter.id, { targetId: revivedPlayerId });
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
  const result = await db.insert(bounties).values({ ...data, expiresAt: data.expiresAt || new Date(Date.now() + 6 * 60 * 60 * 1000) });
  // Update player bounty totals
  const allBounties = await db.select().from(bounties).where(and(eq(bounties.targetPlayerId, data.targetPlayerId), eq(bounties.isActive, true)));
  const totalPoints = allBounties.reduce((sum, b) => sum + b.amount, 0);
  await db.update(gamePlayers).set({ bountyPoints: totalPoints, bountyCount: allBounties.length }).where(eq(gamePlayers.id, data.targetPlayerId));
  return result[0].insertId;
}

export async function getGameBounties(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  await expireBounties(gameId);
  return db.select().from(bounties).where(and(eq(bounties.gameId, gameId), eq(bounties.isActive, true)));
}

export async function expireBounties(gameId: number) {
  const database = await getDb();
  if (!database) return;
  const active = await database.select().from(bounties).where(and(eq(bounties.gameId, gameId), eq(bounties.isActive, true)));
  const affected = new Set<number>();
  for (const bounty of active) {
    if (bounty.expiresAt && bounty.expiresAt.getTime() <= Date.now()) {
      await database.update(bounties).set({ isActive: false }).where(eq(bounties.id, bounty.id));
      affected.add(bounty.targetPlayerId);
    }
  }
  for (const playerId of affected) await refreshPlayerBountyTotals(playerId);
}

export async function refreshPlayerBountyTotals(playerId: number) {
  const database = await getDb();
  if (!database) return;
  const active = await database.select().from(bounties).where(and(eq(bounties.targetPlayerId, playerId), eq(bounties.isActive, true)));
  await database.update(gamePlayers).set({
    bountyPoints: active.reduce((sum, bounty) => sum + bounty.amount, 0),
    bountyCount: active.length,
  }).where(eq(gamePlayers.id, playerId));
}

export async function getBountyBoard(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  await expireBounties(gameId);
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const withBounties = players.filter(p => (p.bountyPoints || 0) > 0);
  const userIds = withBounties.map(p => p.userId);
  const allUsers = await db.select().from(users);
  const userMap = Object.fromEntries(allUsers.filter(u => userIds.includes(u.id)).map(u => [u.id, u]));
  return withBounties
    .sort((a, b) => (b.bountyPoints || 0) - (a.bountyPoints || 0))
    .map(p => ({
      playerId: p.id,
      playerName: userMap[p.userId]?.displayName?.trim() || userMap[p.userId]?.name?.trim() || `Player #${p.userId}`,
      bountyCount: p.bountyCount || 0,
      bountyPoints: p.bountyPoints || 0,
    }));
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

export async function getPlayerPowerUpUsageCount(gamePlayerId: number, powerUpId: number, gameId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(playerPowerUps)
    .where(and(
      eq(playerPowerUps.gamePlayerId, gamePlayerId),
      eq(playerPowerUps.powerUpId, powerUpId),
      eq(playerPowerUps.gameId, gameId),
    ));
  return Number(result?.count ?? 0);
}

export async function purchasePowerUp(gamePlayerId: number, powerUpId: number, gameId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(playerPowerUps).values({
    gamePlayerId,
    powerUpId,
    gameId,
    status: "inventory",
    isActive: false,
    activatedAt: null,
    expiresAt: null,
  });
  return result[0].insertId;
}

export async function getPlayerPowerUps(gamePlayerId: number) {
  const db = await getDb();
  if (!db) return [];
  const inventory = await db.select().from(playerPowerUps).where(eq(playerPowerUps.gamePlayerId, gamePlayerId));
  const catalog = await db.select().from(powerUps);
  const catalogById = Object.fromEntries(catalog.map(powerUp => [powerUp.id, powerUp]));
  return inventory.map(item => ({ ...item, powerUp: catalogById[item.powerUpId] }));
}

export async function getPlayerPowerUpById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(playerPowerUps).where(eq(playerPowerUps.id, id)).limit(1);
  if (!rows.length) return undefined;
  const catalogRows = await db.select().from(powerUps).where(eq(powerUps.id, rows[0].powerUpId)).limit(1);
  return { ...rows[0], powerUp: catalogRows[0] };
}

export async function activatePlayerPowerUp(
  id: number,
  data: { expiresAt: Date | null; targetPlayerId?: number | null; activationData?: Record<string, unknown> | null; activatedRound?: number | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(playerPowerUps).set({
    status: "active",
    isActive: true,
    activatedAt: new Date(),
    expiresAt: data.expiresAt,
    targetPlayerId: data.targetPlayerId ?? null,
    activationData: data.activationData ?? null,
    activatedRound: data.activatedRound ?? null,
  }).where(eq(playerPowerUps.id, id));
}

export async function consumePlayerPowerUp(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(playerPowerUps).set({ status: "consumed", isActive: false, expiresAt: new Date() }).where(eq(playerPowerUps.id, id));
}

export async function setPlayerPowerUpPendingPayment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(playerPowerUps).set({ status: "pending_payment", isActive: false }).where(eq(playerPowerUps.id, id));
}

export async function expirePlayerPowerUps(gameId: number) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const active = await db.select().from(playerPowerUps).where(and(eq(playerPowerUps.gameId, gameId), eq(playerPowerUps.isActive, true)));
  if (!active.length) return;
  const catalog = await db.select().from(powerUps).where(eq(powerUps.gameId, gameId));
  const catalogById = Object.fromEntries(catalog.map(powerUp => [powerUp.id, powerUp]));
  const game = await getGame(gameId);
  for (const item of active) {
    const name = catalogById[item.powerUpId]?.name;
    const roundExpired = name === "Vendetta" && item.activatedRound != null && item.activatedRound !== game?.currentRound;
    if ((item.expiresAt && item.expiresAt <= now) || roundExpired) {
      await db.update(playerPowerUps).set({ status: "expired", isActive: false }).where(eq(playerPowerUps.id, item.id));
      if (name === "Witness Protection") {
        const holder = await getPlayerById(item.gamePlayerId);
        if (holder && holder.status === "safe") {
          await db.update(gamePlayers).set({ status: "alive" }).where(eq(gamePlayers.id, holder.id));
        }
      }
      if (name === "Bodyguard") {
        const holder = await getPlayerById(item.gamePlayerId);
        if (holder) await db.update(gamePlayers).set({ reservedPoints: Math.max(0, (holder.reservedPoints || 0) - 150) }).where(eq(gamePlayers.id, holder.id));
      }
      if (name === "Blackout") {
        const remainingBlackouts = await getActiveGamePowerUpsByName(gameId, "Blackout");
        if (!remainingBlackouts.length) {
          const players = await getGamePlayers(gameId);
          for (const player of players) await createNotification({ userId: player.userId, gameId, type: "power_up_used", title: "Blackout Ended", body: "Player locations are visible again under the normal map rules." });
          await createKillFeedEvent({ gameId, eventType: "power_up_used", message: "Blackout has ended." });
          const { sendPushToUsers } = await import("./push-service");
          await sendPushToUsers(players.map(player => player.userId), { title: "Blackout Ended", body: "Normal map visibility has resumed.", data: { type: "blackout_end", gameId } });
        }
      }
      if (name === "Monkey Wrench") {
        const players = await getGamePlayers(gameId);
        await db.update(games).set({ temporarySafeObject: null, temporarySafeObjectExpiresAt: null }).where(eq(games.id, gameId));
        for (const player of players) await createNotification({ userId: player.userId, gameId, type: "power_up_used", title: "Safe Object Restored", body: `The official safe object is “${game?.safeObject || "not set"}”.` });
        const { sendPushToUsers } = await import("./push-service");
        await sendPushToUsers(players.map(player => player.userId), { title: "Safe Object Restored", body: `Use “${game?.safeObject || "the admin's official object"}”.`, data: { type: "monkey_wrench_end", gameId } });
      }
    }
  }
  if (game?.temporarySafeObjectExpiresAt && game.temporarySafeObjectExpiresAt <= now) {
    await db.update(games).set({ temporarySafeObject: null, temporarySafeObjectExpiresAt: null }).where(eq(games.id, gameId));
  }
}

export async function updatePlayerPowerUpActivationData(id: number, activationData: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(playerPowerUps).set({ activationData }).where(eq(playerPowerUps.id, id));
}

export async function approveSanctuaryPowerUp(id: number, activationData: Record<string, unknown>) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await database.update(playerPowerUps).set({ activationData, isActive: true, status: "active", activatedAt: new Date(), expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) }).where(eq(playerPowerUps.id, id));
}

export async function returnPowerUpToInventory(id: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await database.update(playerPowerUps).set({ status: "inventory", isActive: false, activatedAt: null, expiresAt: null, targetPlayerId: null, activationData: null, activatedRound: null }).where(eq(playerPowerUps.id, id));
}

export async function pausePurgeSensitivePowerUps(gameId: number) {
  const database = await getDb();
  if (!database) return;
  const inventory = await database.select().from(playerPowerUps).where(and(eq(playerPowerUps.gameId, gameId), eq(playerPowerUps.isActive, true)));
  const catalog = await database.select().from(powerUps).where(eq(powerUps.gameId, gameId));
  const names = Object.fromEntries(catalog.map(powerUp => [powerUp.id, powerUp.name]));
  for (const item of inventory) {
    if (!["Untouchable", "Bodyguard"].includes(names[item.powerUpId]) || !item.expiresAt) continue;
    await database.update(playerPowerUps).set({
      isActive: false,
      pausedAt: new Date(),
      remainingDurationSeconds: Math.max(1, Math.ceil((item.expiresAt.getTime() - Date.now()) / 1000)),
      expiresAt: null,
    }).where(eq(playerPowerUps.id, item.id));
  }
}

export async function resumePurgeSensitivePowerUps(gameId: number) {
  const database = await getDb();
  if (!database) return;
  const inventory = await database.select().from(playerPowerUps).where(eq(playerPowerUps.gameId, gameId));
  for (const item of inventory) {
    if (item.status !== "active" || !item.pausedAt || !item.remainingDurationSeconds) continue;
    await database.update(playerPowerUps).set({
      isActive: true,
      pausedAt: null,
      expiresAt: new Date(Date.now() + item.remainingDurationSeconds * 1000),
      remainingDurationSeconds: null,
    }).where(eq(playerPowerUps.id, item.id));
  }
}

export async function getPendingSanctuaryZones(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  const catalog = await db.select().from(powerUps).where(and(eq(powerUps.gameId, gameId), eq(powerUps.name, "Sanctuary")));
  const sanctuaryIds = new Set(catalog.map(powerUp => powerUp.id));
  if (!sanctuaryIds.size) return [];
  const active = await db.select().from(playerPowerUps).where(and(eq(playerPowerUps.gameId, gameId), eq(playerPowerUps.isActive, true)));
  const pending = active.filter(item => sanctuaryIds.has(item.powerUpId) && !(item.activationData as { approved?: boolean } | null)?.approved);
  const players = await getGamePlayers(gameId);
  const playerMap = Object.fromEntries(players.map(player => [player.id, player]));
  return pending.map(item => ({ ...item, player: playerMap[item.gamePlayerId] }));
}

export async function getActivePowerUpByName(gamePlayerId: number, name: string) {
  const inventory = await getPlayerPowerUps(gamePlayerId);
  const now = Date.now();
  return inventory.find(item => item.status === "active" && item.isActive && (!item.expiresAt || item.expiresAt.getTime() > now) && item.powerUp?.name === name);
}

export async function getActiveTargetedPowerUp(gameId: number, targetPlayerId: number, name: string) {
  const db = await getDb();
  if (!db) return undefined;
  const active = await db.select().from(playerPowerUps).where(and(eq(playerPowerUps.gameId, gameId), eq(playerPowerUps.isActive, true), eq(playerPowerUps.targetPlayerId, targetPlayerId)));
  const catalog = await db.select().from(powerUps).where(eq(powerUps.gameId, gameId));
  const names = Object.fromEntries(catalog.map(powerUp => [powerUp.id, powerUp.name]));
  const now = Date.now();
  return active.find(item => (!item.expiresAt || item.expiresAt.getTime() > now) && names[item.powerUpId] === name);
}

export async function getActiveGamePowerUpsByName(gameId: number, name: string) {
  const db = await getDb();
  if (!db) return [];
  const active = await db.select().from(playerPowerUps).where(and(eq(playerPowerUps.gameId, gameId), eq(playerPowerUps.isActive, true)));
  const catalog = await db.select().from(powerUps).where(eq(powerUps.gameId, gameId));
  const catalogById = Object.fromEntries(catalog.map(powerUp => [powerUp.id, powerUp]));
  const now = Date.now();
  return active
    .filter(item => (!item.expiresAt || item.expiresAt.getTime() > now) && catalogById[item.powerUpId]?.name === name)
    .map(item => ({ ...item, powerUp: catalogById[item.powerUpId] }));
}

export async function getGamePowerUpActivationsByName(gameId: number, name: string) {
  const database = await getDb();
  if (!database) return [];
  const inventory = await database.select().from(playerPowerUps).where(eq(playerPowerUps.gameId, gameId));
  const catalog = await database.select().from(powerUps).where(and(eq(powerUps.gameId, gameId), eq(powerUps.name, name)));
  const ids = new Set(catalog.map(powerUp => powerUp.id));
  return inventory.filter(item => ids.has(item.powerUpId) && item.activatedAt);
}

export async function getPowerUpEligibleAt(gamePlayerId: number, name: string, at: Date) {
  const inventory = await getPlayerPowerUps(gamePlayerId);
  return inventory.find(item => item.powerUp?.name === name
    && item.activatedAt && item.activatedAt <= at
    && (!item.expiresAt || item.expiresAt >= at)
    && item.status !== "consumed");
}

export async function deactivateAllPlayerPowerUps(gamePlayerId: number, excludedNames: string[] = []) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const active = await getPlayerPowerUps(gamePlayerId);
  const eligible = active.filter(item => item.isActive && item.status === "active" && !excludedNames.includes(item.powerUp?.name || ""));
  for (const item of eligible) {
    if (item.powerUp?.name === "Bodyguard") {
      const holder = await getPlayerById(item.gamePlayerId);
      if (holder) await updatePlayer(holder.id, { reservedPoints: Math.max(0, (holder.reservedPoints || 0) - 150) });
    }
    await consumePlayerPowerUp(item.id);
  }
  const holder = await getPlayerById(gamePlayerId);
  if (holder?.status === "safe" && eligible.some(item => item.powerUp?.name === "Witness Protection")) {
    await updatePlayer(gamePlayerId, { status: "alive" });
  }
  return eligible.length;
}

export async function transferPlayerPowerUp(id: number, toGamePlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(playerPowerUps).set({ gamePlayerId: toGamePlayerId }).where(eq(playerPowerUps.id, id));
}

export async function createPowerUpUsageFee(data: typeof powerUpUsageFees.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(powerUpUsageFees).values(data);
  return result[0].insertId;
}

export async function getPowerUpUsageFee(playerPowerUpId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(powerUpUsageFees).where(eq(powerUpUsageFees.playerPowerUpId, playerPowerUpId)).limit(1);
  return rows[0];
}

export async function getGamePowerUpUsageFees(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  const fees = await db.select().from(powerUpUsageFees).where(eq(powerUpUsageFees.gameId, gameId));
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const inventory = await db.select().from(playerPowerUps).where(eq(playerPowerUps.gameId, gameId));
  const catalog = await db.select().from(powerUps).where(eq(powerUps.gameId, gameId));
  const allUsers = await db.select().from(users);
  return fees.map(fee => {
    const player = players.find(candidate => candidate.id === fee.gamePlayerId);
    const item = inventory.find(candidate => candidate.id === fee.playerPowerUpId);
    const powerUp = catalog.find(candidate => candidate.id === item?.powerUpId);
    const user = allUsers.find(candidate => candidate.id === player?.userId);
    return {
      ...fee,
      playerName: user?.displayName?.trim() || user?.name?.trim() || `Player #${player?.userId ?? fee.gamePlayerId}`,
      powerUpName: powerUp?.name || "Power-up",
    };
  });
}

export async function resolvePowerUpUsageFee(id: number, status: "paid" | "waived", markedByUserId: number, note?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(powerUpUsageFees).set({ status, markedByUserId, note, resolvedAt: new Date() }).where(eq(powerUpUsageFees.id, id));
}

export async function clearPlayerBounties(gameId: number, targetPlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bounties).set({ isActive: false }).where(and(eq(bounties.gameId, gameId), eq(bounties.targetPlayerId, targetPlayerId), eq(bounties.isActive, true)));
  await db.update(gamePlayers).set({ bountyPoints: 0, bountyCount: 0 }).where(eq(gamePlayers.id, targetPlayerId));
}

export async function doublePlayerBounties(gameId: number, targetPlayerId: number, placedByPlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await expireBounties(gameId);
  const active = await db.select().from(bounties).where(and(eq(bounties.gameId, gameId), eq(bounties.targetPlayerId, targetPlayerId), eq(bounties.isActive, true)));
  if (!active.length) throw new Error("The selected player has no active bounty to raise");
  for (const bounty of active) await db.update(bounties).set({ amount: bounty.amount * 2 }).where(eq(bounties.id, bounty.id));
  const total = active.reduce((sum, bounty) => sum + bounty.amount * 2, 0);
  await db.update(gamePlayers).set({ bountyPoints: total, bountyCount: active.length }).where(eq(gamePlayers.id, targetPlayerId));
  return total;
}

export async function transferPlayerBounties(gameId: number, fromPlayerId: number, toPlayerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await expireBounties(gameId);
  const active = await db.select().from(bounties).where(and(eq(bounties.gameId, gameId), eq(bounties.targetPlayerId, fromPlayerId), eq(bounties.isActive, true)));
  if (!active.length) throw new Error("You do not have an active bounty to transfer");
  for (const bounty of active) await db.update(bounties).set({ targetPlayerId: toPlayerId }).where(eq(bounties.id, bounty.id));
  const total = active.reduce((sum, bounty) => sum + bounty.amount, 0);
  await db.update(gamePlayers).set({ bountyPoints: 0, bountyCount: 0 }).where(eq(gamePlayers.id, fromPlayerId));
  const target = await getPlayerById(toPlayerId);
  await db.update(gamePlayers).set({ bountyPoints: (target?.bountyPoints || 0) + total, bountyCount: (target?.bountyCount || 0) + active.length }).where(eq(gamePlayers.id, toPlayerId));
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
  const pending = await db.select().from(eliminations).where(and(eq(eliminations.gameId, gameId), eq(eliminations.status, "pending")));
  const players = await getGamePlayers(gameId);
  const playerMap = Object.fromEntries(players.map(player => [player.id, player]));
  return Promise.all(pending.map(async elimination => {
    const defenderInventory = await getPlayerPowerUps(elimination.eliminatedId);
    const protection = defenderInventory.find(item => item.status === "active" && item.isActive && ["Immunity Shield", "Untouchable", "Witness Protection"].includes(item.powerUp?.name || ""));
    return { ...elimination, eliminator: playerMap[elimination.eliminatorId], eliminated: playerMap[elimination.eliminatedId], activeProtection: protection?.powerUp?.name || null, protectionExpiresAt: protection?.expiresAt || null };
  }));
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

export async function getLatestApprovedEliminationForPlayer(gameId: number, gamePlayerId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(eliminations)
    .where(and(eq(eliminations.gameId, gameId), eq(eliminations.eliminatedId, gamePlayerId), eq(eliminations.status, "approved")))
    .orderBy(desc(eliminations.reviewedAt))
    .limit(1);
  return rows[0];
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
  const events = await db.select().from(killFeed).where(eq(killFeed.gameId, gameId)).orderBy(desc(killFeed.createdAt)).limit(limit);
  const players = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
  const playerMap = Object.fromEntries(players.map(player => [player.id, player]));
  const userIds = players.map(player => player.userId);
  const gameUsers = await db.select().from(users);
  const userMap = Object.fromEntries(gameUsers.filter(user => userIds.includes(user.id)).map(user => [user.id, user]));
  const getPlayerName = (playerId: number | null) => {
    if (!playerId) return null;
    const player = playerMap[playerId];
    if (!player) return `Player #${playerId}`;
    const user = userMap[player.userId];
    return user?.displayName?.trim() || user?.name?.trim() || `Player #${player.userId}`;
  };

  return events.map(event => ({
    ...event,
    actorName: getPlayerName(event.actorId),
    targetName: getPlayerName(event.targetId),
  }));
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

export async function getMapPowerUpDiscoveries(gamePlayerId: number) {
  const database = await getDb();
  if (!database) return [];
  return database.select().from(mapPowerUpGuesses).where(and(eq(mapPowerUpGuesses.gamePlayerId, gamePlayerId), eq(mapPowerUpGuesses.isCorrect, true)));
}

export async function claimMapPowerUp(id: number, playerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(mapPowerUps).where(eq(mapPowerUps.id, id)).limit(1);
  const mapPowerUp = rows[0];
  if (!mapPowerUp) throw new Error("This map power-up no longer exists");
  if (mapPowerUp.claimedBy) throw new Error("This power-up has already been claimed");
  await db.update(mapPowerUps).set({ claimedBy: playerId }).where(eq(mapPowerUps.id, id));
  await purchasePowerUp(playerId, mapPowerUp.powerUpId, mapPowerUp.gameId);
}

// ===== DUEL QUERIES (Sniper's Duel) =====

export async function createDuel(data: { gameId: number; challengerId: number; opponentId: number; challengerStakeId: number; stakeDeadline: Date }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(duels).values(data);
  await db.update(playerPowerUps).set({ lockedForDuelId: result[0].insertId }).where(eq(playerPowerUps.id, data.challengerStakeId));
  return result[0].insertId;
}

export async function getDuel(duelId: number) {
  const database = await getDb();
  if (!database) return undefined;
  return (await database.select().from(duels).where(eq(duels.id, duelId)).limit(1))[0];
}

export async function getPlayerDuels(gameId: number, playerId: number) {
  const database = await getDb();
  if (!database) return [];
  const all = await database.select().from(duels).where(eq(duels.gameId, gameId));
  return all.filter(duel => duel.challengerId === playerId || duel.opponentId === playerId);
}

export async function setDuelOpponentStake(duelId: number, opponentStakeId: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await database.update(duels).set({ opponentStakeId, status: "awaiting_result" }).where(eq(duels.id, duelId));
  await database.update(playerPowerUps).set({ lockedForDuelId: duelId }).where(eq(playerPowerUps.id, opponentStakeId));
}

export async function submitDuelResult(duelId: number, proposedWinnerId: number, evidenceUrl?: string, witnessName?: string, submissionNotes?: string) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await database.update(duels).set({ proposedWinnerId, evidenceUrl, witnessName, submissionNotes, submittedAt: new Date(), status: "pending_review" }).where(eq(duels.id, duelId));
}

export async function getPendingDuels(gameId: number) {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select().from(duels).where(eq(duels.gameId, gameId));
  const pending = all.filter(duel => duel.status === "pending_review");
  const players = await getGamePlayers(gameId);
  const playerMap = Object.fromEntries(players.map(p => [p.id, p]));
  return pending.map(duel => ({
    ...duel,
    challenger: playerMap[duel.challengerId],
    opponent: playerMap[duel.opponentId],
  }));
}

export async function resolveDuel(duelId: number, approved: boolean, reviewedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(duels).where(eq(duels.id, duelId)).limit(1);
  const duel = rows[0];
  if (!duel) throw new Error("Duel not found");
  if (duel.status !== "pending_review" || !duel.proposedWinnerId) throw new Error("This duel is not awaiting review");
  const winnerId = duel.proposedWinnerId;
  const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
  if (!approved) {
    await db.update(duels).set({ status: "rejected", reviewedBy, resolvedAt: new Date() }).where(eq(duels.id, duelId));
    if (duel.challengerStakeId) await db.update(playerPowerUps).set({ lockedForDuelId: null }).where(eq(playerPowerUps.id, duel.challengerStakeId));
    if (duel.opponentStakeId) await db.update(playerPowerUps).set({ lockedForDuelId: null }).where(eq(playerPowerUps.id, duel.opponentStakeId));
    return { winnerId, loserId, stoleItem: false, approved: false };
  }
  await db.update(duels).set({ status: "resolved", winnerId, reviewedBy, resolvedAt: new Date() }).where(eq(duels.id, duelId));
  const winner = await getPlayerById(winnerId);
  if (winner) await updatePlayer(winnerId, { points: (winner.points || 0) + 350 });
  const loserStakeId = loserId === duel.challengerId ? duel.challengerStakeId : duel.opponentStakeId;
  const winnerStakeId = winnerId === duel.challengerId ? duel.challengerStakeId : duel.opponentStakeId;
  if (loserStakeId) await db.update(playerPowerUps).set({ gamePlayerId: winnerId, lockedForDuelId: null }).where(eq(playerPowerUps.id, loserStakeId));
  if (winnerStakeId) await db.update(playerPowerUps).set({ lockedForDuelId: null }).where(eq(playerPowerUps.id, winnerStakeId));
  return { winnerId, loserId, stoleItem: Boolean(loserStakeId), approved: true };
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
  const completedGames = allGames.filter(g => allGameIds.includes(g.id) && g.status === "completed" && !g.deletedAt);
  // For each completed game, attach the user's player record (if any)
  const playerMap = Object.fromEntries(playerGames.map(p => [p.gameId, p]));
  return completedGames
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(g => ({ ...g, myPlayer: playerMap[g.id] ?? null }));
}
