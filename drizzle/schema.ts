import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  displayName: varchar("displayName", { length: 50 }),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  isSuperAdmin: boolean("isSuperAdmin").default(false),
  avatarUrl: text("avatarUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const games = mysqlTable("games", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  gameType: mysqlEnum("gameType", ["last_man_standing", "highest_points", "most_eliminations", "teams"]).notNull(),
  status: mysqlEnum("status", ["setup", "active", "paused", "completed"]).default("setup").notNull(),
  entryFee: int("entryFee").default(0),
  roundLength: int("roundLength").default(72), // hours
  currentRound: int("currentRound").default(0),
  safeObject: varchar("safeObject", { length: 255 }),
  targetAssignment: mysqlEnum("targetAssignment", ["auto", "manual"]).default("auto").notNull(),
  purgeActive: boolean("purgeActive").default(false),
  purgeEndTime: timestamp("purgeEndTime"),
  roundEndTime: timestamp("roundEndTime"),
  endCondition: varchar("endCondition", { length: 255 }),
  showLocationsDuringPurge: boolean("showLocationsDuringPurge").default(true),
  // New fields
  joinCode: varchar("joinCode", { length: 10 }),
  inheritTarget: boolean("inheritTarget").default(true), // killer inherits victim's target
  startingPoints: int("startingPoints").default(0), // points all players start with
  eliminationPoints: int("eliminationPoints").default(100), // points awarded per kill
  locationPingInterval: int("locationPingInterval").default(15), // minutes between required pings
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const gamePlayers = mysqlTable("game_players", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["alive", "eliminated", "safe"]).default("alive").notNull(),
  hasPaid: boolean("hasPaid").default(false),
  points: int("points").default(0),
  pendingDiscountPercent: int("pendingDiscountPercent"), // one-time roulette coupon for the next power-up purchase
  reviveCredits: int("reviveCredits").default(0), // banked extra lives from Vampire, max 3
  kills: int("kills").default(0),
  deaths: int("deaths").default(0),
  targetId: int("targetId"),
  nextRoundTargetId: int("nextRoundTargetId"),
  partnerId: int("partnerId"),
  teamId: int("teamId"),
  currentSafeObject: varchar("currentSafeObject", { length: 255 }),
  latitude: text("latitude"),
  longitude: text("longitude"),
  locationUpdatedAt: timestamp("locationUpdatedAt"),
  locationEnabled: boolean("locationEnabled").default(true), // track if player has location on
  bountyPoints: int("bountyPoints").default(0), // total bounty on this player
  bountyCount: int("bountyCount").default(0), // number of bounties placed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const bounties = mysqlTable("bounties", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  targetPlayerId: int("targetPlayerId").notNull(), // player the bounty is on
  placedByPlayerId: int("placedByPlayerId").notNull(), // who placed it
  amount: int("amount").notNull(), // points value
  isActive: boolean("isActive").default(true),
  claimedByPlayerId: int("claimedByPlayerId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const gameRules = mysqlTable("game_rules", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  ruleText: text("ruleText").notNull(),
  isStandard: boolean("isStandard").default(false),
  isEnabled: boolean("isEnabled").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const powerUps = mysqlTable("power_ups", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  emoji: varchar("emoji", { length: 10 }).notNull(),
  effect: text("effect").notNull(),
  cost: int("cost").notNull(),
  usageFeeCents: int("usageFeeCents").default(0).notNull(), // manually collected cash fee
  duration: int("duration"), // minutes, null = instant/permanent
  maxUsesPerGame: int("maxUsesPerGame"), // null = unlimited purchases per game
  isEnabled: boolean("isEnabled").default(true),
  discount: int("discount").default(0), // percentage
  category: mysqlEnum("category", ["offensive", "defensive", "utility", "special", "chaos"]).default("utility").notNull(),
  description: text("description"), // detailed description for shop display
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const playerPowerUps = mysqlTable("player_power_ups", {
  id: int("id").autoincrement().primaryKey(),
  gamePlayerId: int("gamePlayerId").notNull(),
  powerUpId: int("powerUpId").notNull(),
  gameId: int("gameId").notNull(),
  status: mysqlEnum("status", ["inventory", "pending_payment", "active", "consumed", "expired"]).default("inventory").notNull(),
  isActive: boolean("isActive").default(false), // retained for compatibility with existing queries
  purchasedAt: timestamp("purchasedAt").defaultNow().notNull(),
  activatedAt: timestamp("activatedAt"),
  expiresAt: timestamp("expiresAt"),
  targetPlayerId: int("targetPlayerId"),
  activationData: json("activationData"),
  usesRemaining: int("usesRemaining").default(1).notNull(),
});

export const powerUpUsageFees = mysqlTable("power_up_usage_fees", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  gamePlayerId: int("gamePlayerId").notNull(),
  playerPowerUpId: int("playerPowerUpId").notNull(),
  amountCents: int("amountCents").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "waived"]).default("pending").notNull(),
  markedByUserId: int("markedByUserId"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export const eliminations = mysqlTable("eliminations", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  eliminatorId: int("eliminatorId").notNull(),
  eliminatedId: int("eliminatedId").notNull(),
  videoUrl: text("videoUrl"),
  status: mysqlEnum("status", ["pending", "approved", "denied"]).default("pending").notNull(),
  reviewedBy: int("reviewedBy"),
  round: int("round").default(1),
  pointsAwarded: int("pointsAwarded").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
});

export const chatMessages = mysqlTable("chat_messages", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  userId: int("userId").notNull(),
  message: text("message").notNull(),
  isSystem: boolean("isSystem").default(false),
  powerUpIcon: varchar("powerUpIcon", { length: 10 }), // emoji icon if this is a power-up notification
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const achievements = mysqlTable("achievements", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  emoji: varchar("emoji", { length: 10 }),
  pointsValue: int("pointsValue").default(0),
  condition: text("condition"),
  achievementType: varchar("achievementType", { length: 50 }), // combat, survival, chaos
  category: varchar("category", { length: 50 }), // Game, Lifetime, Round
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const playerAchievements = mysqlTable("player_achievements", {
  id: int("id").autoincrement().primaryKey(),
  gamePlayerId: int("gamePlayerId").notNull(),
  achievementId: int("achievementId").notNull(),
  earnedAt: timestamp("earnedAt").defaultNow().notNull(),
});

export const mapPowerUps = mysqlTable("map_power_ups", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  powerUpId: int("powerUpId").notNull(),
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  isVisible: boolean("isVisible").default(true),
  clue: text("clue"),
  claimedBy: int("claimedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const duels = mysqlTable("duels", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  challengerId: int("challengerId").notNull(), // gamePlayers.id
  opponentId: int("opponentId").notNull(), // gamePlayers.id
  status: mysqlEnum("status", ["pending", "resolved"]).default("pending").notNull(),
  winnerId: int("winnerId"), // gamePlayers.id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export const killFeed = mysqlTable("kill_feed", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  eventType: mysqlEnum("eventType", ["elimination_approved", "elimination_denied", "revival", "purge_start", "purge_end", "round_start", "round_end", "game_start", "game_end", "power_up_used", "achievement_earned", "bounty_placed", "bounty_claimed", "location_disabled"]).notNull(),
  actorId: int("actorId"),
  targetId: int("targetId"),
  message: text("message").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const teams = mysqlTable("teams", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  gameId: int("gameId"),
  type: varchar("type", { length: 50 }).notNull(), // new_target, purge_start, elimination_result, bounty, location_disabled
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  isRead: boolean("isRead").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type InsertGamePlayer = typeof gamePlayers.$inferInsert;
export type PowerUp = typeof powerUps.$inferSelect;
export type Elimination = typeof eliminations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type KillFeedEvent = typeof killFeed.$inferSelect;
export const rouletteOutcomes = mysqlTable("roulette_outcomes", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  emoji: varchar("emoji", { length: 10 }).notNull(),
  type: mysqlEnum("type", ["power_up", "points_bonus", "points_penalty", "discount_coupon", "nothing", "custom"]).notNull(),
  value: int("value").default(0), // points amount, discount %, or powerUpId
  powerUpId: int("powerUpId"), // if type is power_up, which one
  weight: int("weight").default(1).notNull(), // relative probability
  description: text("description"),
  isEnabled: boolean("isEnabled").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Push notification tokens for device-level push delivery
export const pushTokens = mysqlTable("push_tokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  token: text("token").notNull(),
  platform: varchar("platform", { length: 10 }).default("expo"), // expo, apns, fcm
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Player guesses for hidden map power-up locations
export const mapPowerUpGuesses = mysqlTable("map_power_up_guesses", {
  id: int("id").autoincrement().primaryKey(),
  mapPowerUpId: int("mapPowerUpId").notNull(),
  gamePlayerId: int("gamePlayerId").notNull(),
  guessLatitude: text("guessLatitude").notNull(),
  guessLongitude: text("guessLongitude").notNull(),
  guessAddress: text("guessAddress"),
  isCorrect: boolean("isCorrect").default(false),
  distanceMeters: int("distanceMeters"), // distance from actual location
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Bounty = typeof bounties.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type RouletteOutcome = typeof rouletteOutcomes.$inferSelect;
export type PushToken = typeof pushTokens.$inferSelect;
export type MapPowerUpGuess = typeof mapPowerUpGuesses.$inferSelect;
export type PlayerPowerUp = typeof playerPowerUps.$inferSelect;
export type PowerUpUsageFee = typeof powerUpUsageFees.$inferSelect;
