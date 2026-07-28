import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { storagePut } from "./storage";
import { sendPushToUser, sendPushToUsers, registerPushToken } from "./push-service";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    registerPushToken: protectedProcedure
      .input(z.object({ token: z.string(), platform: z.string().default("expo") }))
      .mutation(async ({ ctx, input }) => {
        await registerPushToken(ctx.user.id, input.token, input.platform);
        return { success: true };
      }),
    updateDisplayName: protectedProcedure
      .input(z.object({ displayName: z.string().max(50).nullable() }))
      .mutation(async ({ ctx, input }) => {
        const displayName = input.displayName?.trim() || null;
        await db.updateUserDisplayName(ctx.user.id, displayName);
        return { success: true, displayName };
      }),
  }),

  game: router({
    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        gameType: z.enum(["last_man_standing", "highest_points", "most_eliminations", "teams"]),
        entryFee: z.number().default(0),
        roundLength: z.number().default(72),
        safeObject: z.string().optional(),
        targetAssignment: z.enum(["auto", "manual"]).default("auto"),
        endCondition: z.string().optional(),
        showLocationsDuringPurge: z.boolean().default(true),
        inheritTarget: z.boolean().default(true),
        startingPoints: z.number().default(0),
        eliminationPoints: z.number().default(100),
        purgeEliminationPoints: z.number().nullable().optional(),
        locationPingInterval: z.number().default(15),
      }))
      .mutation(async ({ ctx, input }) => {
        const gameId = await db.createGame({ ...input, adminId: ctx.user.id });
        await db.joinGame({ gameId, userId: ctx.user.id });
        return { gameId };
      }),

    get: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getGame(input.gameId);
      }),

    myGames: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserGames(ctx.user.id);
    }),

    adminGames: protectedProcedure.query(async ({ ctx }) => {
      return db.getAdminGames(ctx.user.id);
    }),

    update: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        name: z.string().optional(),
        status: z.enum(["setup", "active", "paused", "completed"]).optional(),
        entryFee: z.number().optional(),
        roundLength: z.number().optional(),
        safeObject: z.string().optional(),
        targetAssignment: z.enum(["auto", "manual"]).optional(),
        purgeActive: z.boolean().optional(),
        purgeEndTime: z.string().optional(),
        roundEndTime: z.string().optional(),
        currentRound: z.number().optional(),
        showLocationsDuringPurge: z.boolean().optional(),
        inheritTarget: z.boolean().optional(),
        startingPoints: z.number().optional(),
        eliminationPoints: z.number().optional(),
        purgeEliminationPoints: z.number().nullable().optional(),
        locationPingInterval: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { gameId, purgeEndTime, roundEndTime, ...rest } = input;
        const updateData: any = { ...rest };
        if (purgeEndTime) updateData.purgeEndTime = new Date(purgeEndTime);
        if (roundEndTime) updateData.roundEndTime = new Date(roundEndTime);
        await db.updateGame(gameId, updateData);
        return { success: true };
      }),

    join: protectedProcedure
      .input(z.object({ gameId: z.number().optional(), joinCode: z.string().optional(), safeObject: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        let gameId = input.gameId;
        if (!gameId && input.joinCode) {
          const game = await db.getGameByJoinCode(input.joinCode.toUpperCase());
          if (!game) throw new Error("Invalid join code");
          gameId = game.id;
        }
        if (!gameId) throw new Error("Game ID or join code required");
        const existing = await db.getPlayerInGame(gameId, ctx.user.id);
        if (existing) return { playerId: existing.id, gameId };
        const playerId = await db.joinGame({ gameId, userId: ctx.user.id, currentSafeObject: input.safeObject });
        return { playerId, gameId };
      }),

    startPurge: protectedProcedure
      .input(z.object({ gameId: z.number(), durationMinutes: z.number().default(60) }))
      .mutation(async ({ input }) => {
        const endTime = new Date(Date.now() + input.durationMinutes * 60000);
        await db.updateGame(input.gameId, { purgeActive: true, purgeEndTime: endTime });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "purge_start", message: `⚠️ PURGE ACTIVATED! ${input.durationMinutes} minutes of chaos!` });
        // Notify all players (in-app + push)
        const players = await db.getGamePlayers(input.gameId);
        const playerUserIds = players.map(p => p.userId).filter(Boolean) as number[];
        for (const p of players) {
          await db.createNotification({ userId: p.userId, gameId: input.gameId, type: "purge_start", title: "PURGE ACTIVATED", body: `${input.durationMinutes} minutes of chaos! All players can be eliminated.` });
        }
        // Send device push to all players
        await sendPushToUsers(playerUserIds, {
          title: "⚠️ PURGE ACTIVATED!",
          body: `${input.durationMinutes} minutes of chaos! All players can be eliminated.`,
          data: { type: "purge_start", gameId: input.gameId },
        });
        return { success: true };
      }),

    endPurge: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        await db.updateGame(input.gameId, { purgeActive: false, purgeEndTime: null });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "purge_end", message: "🕊️ Purge has ended. Normal rules resume." });
        // Push notify all players purge ended
        const purgeEndPlayers = await db.getGamePlayers(input.gameId);
        const purgeEndUserIds = purgeEndPlayers.map(p => p.userId).filter(Boolean) as number[];
        await sendPushToUsers(purgeEndUserIds, {
          title: "🕊️ Purge Ended",
          body: "Normal rules resume. Watch your back.",
          data: { type: "purge_end", gameId: input.gameId },
        });
        return { success: true };
      }),

    startRound: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        const game = await db.getGame(input.gameId);
        if (!game) throw new Error("Game not found");
        const newRound = (game.currentRound || 0) + 1;
        const roundEnd = new Date(Date.now() + (game.roundLength || 72) * 3600000);
        const roundPlayers = await db.getGamePlayers(input.gameId);
        for (const player of roundPlayers) {
          if (player.nextRoundTargetId) await db.updatePlayer(player.id, { targetId: player.nextRoundTargetId, nextRoundTargetId: null });
        }
        await db.updateGame(input.gameId, { currentRound: newRound, roundEndTime: roundEnd, status: "active" });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "round_start", message: `🎯 Round ${newRound} has begun!` });
        return { success: true };
      }),

    endRound: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        const game = await db.getGame(input.gameId);
        await db.updateGame(input.gameId, { roundEndTime: null });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "round_end", message: `🏁 Round ${game?.currentRound || 0} has ended!` });
        return { success: true };
      }),

    endGame: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        await db.updateGame(input.gameId, { status: "completed" });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "game_end", message: "🏆 Game Over!" });
        return { success: true };
      }),

    leaderboard: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getLeaderboard(input.gameId);
      }),

    history: protectedProcedure.query(async ({ ctx }) => {
      return db.getCompletedGames(ctx.user.id);
    }),

    historyDetail: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        const players = await db.getGamePlayers(input.gameId);
        const killFeed = await db.getKillFeed(input.gameId);
        const leaderboard = await db.getLeaderboard(input.gameId);
        // Find the requesting user's player record in this game
        const myPlayer = players.find(p => p.userId === ctx.user.id);
        return { game, players, killFeed, leaderboard, myPlayer };
      }),
  }),

  player: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const players = await db.getGamePlayers(input.gameId);
        const game = await db.getGame(input.gameId);
        if (game?.adminId === ctx.user.id || ctx.user.isSuperAdmin) return players;
        const viewer = players.find(player => player.userId === ctx.user.id);
        if (!viewer) return [];
        await db.expirePlayerPowerUps(input.gameId);
        const blackout = (await db.getActiveGamePowerUpsByName(input.gameId, "Blackout")).length > 0;
        if (blackout) return players.map(player => ({ ...player, latitude: null, longitude: null }));
        const hiddenIds = new Set<number>();
        const radar = await db.getActivePowerUpByName(viewer.id, "Radar");
        const vendetta = await db.getActivePowerUpByName(viewer.id, "Vendetta");
        const vendettaTargetId = vendetta?.targetPlayerId ?? null;
        const canSeeAll = Boolean(radar || (game?.purgeActive && game.showLocationsDuringPurge));
        for (const player of players) {
          if (player.id === viewer.id) continue;
          if (!canSeeAll && player.id !== viewer.targetId && player.id !== vendettaTargetId) {
            hiddenIds.add(player.id);
            continue;
          }
          const hidden = await Promise.all([
            db.getActivePowerUpByName(player.id, "Dead Zone"),
            db.getActivePowerUpByName(player.id, "Witness Protection"),
            radar ? db.getActivePowerUpByName(player.id, "Burner Phone") : Promise.resolve(undefined),
          ]);
          if (hidden.some(Boolean)) hiddenIds.add(player.id);
        }
        const visiblePlayers = players.map(player => hiddenIds.has(player.id) ? { ...player, latitude: null, longitude: null } : { ...player });
        const swaps = await db.getActiveGamePowerUpsByName(input.gameId, "Doppleganger");
        for (const swap of swaps) {
          if (!swap.targetPlayerId) continue;
          const owner = visiblePlayers.find(player => player.id === swap.gamePlayerId);
          const target = visiblePlayers.find(player => player.id === swap.targetPlayerId);
          if (!owner || !target) continue;
          const ownerLocation = { latitude: owner.latitude, longitude: owner.longitude };
          owner.latitude = target.latitude;
          owner.longitude = target.longitude;
          target.latitude = ownerLocation.latitude;
          target.longitude = ownerLocation.longitude;
        }
        const withZones: Array<(typeof visiblePlayers)[number] & { sanctuaryZone?: { latitude: string; longitude: string; radiusMeters: number; approved: boolean } | null }> = visiblePlayers;
        for (const otherPlayer of withZones) {
          if (otherPlayer.id === viewer.id || hiddenIds.has(otherPlayer.id)) continue;
          const decoy = await db.getActivePowerUpByName(otherPlayer.id, "Decoy");
          const decoyData = decoy?.activationData as { decoyLatitude?: string; decoyLongitude?: string } | null | undefined;
          if (decoyData?.decoyLatitude && decoyData?.decoyLongitude) {
            otherPlayer.latitude = decoyData.decoyLatitude;
            otherPlayer.longitude = decoyData.decoyLongitude;
          }
          const sanctuary = await db.getActivePowerUpByName(otherPlayer.id, "Sanctuary");
          const zoneData = sanctuary?.activationData as { zoneLatitude?: string; zoneLongitude?: string; zoneRadiusMeters?: number; approved?: boolean } | null | undefined;
          if (zoneData?.zoneLatitude && zoneData?.zoneLongitude && zoneData.approved) {
            otherPlayer.sanctuaryZone = {
              latitude: zoneData.zoneLatitude,
              longitude: zoneData.zoneLongitude,
              radiusMeters: zoneData.zoneRadiusMeters || 30,
              approved: true,
            };
          }
        }
        const selfEntry = withZones.find(p => p.id === viewer.id);
        if (selfEntry) {
          const ownSanctuary = await db.getActivePowerUpByName(viewer.id, "Sanctuary");
          const ownZoneData = ownSanctuary?.activationData as { zoneLatitude?: string; zoneLongitude?: string; zoneRadiusMeters?: number; approved?: boolean } | null | undefined;
          if (ownZoneData?.zoneLatitude && ownZoneData?.zoneLongitude) {
            selfEntry.sanctuaryZone = {
              latitude: ownZoneData.zoneLatitude,
              longitude: ownZoneData.zoneLongitude,
              radiusMeters: ownZoneData.zoneRadiusMeters || 30,
              approved: Boolean(ownZoneData.approved),
            };
          }
        }
        return withZones;
      }),

    checkLocation: protectedProcedure
      .input(z.object({ gameId: z.number(), targetPlayerId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        const viewer = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!viewer) throw new Error("Not in this game");
        const target = await db.getPlayerById(input.targetPlayerId);
        if (!target || target.gameId !== input.gameId) throw new Error("Player not found");
        const isAdmin = game?.adminId === ctx.user.id || ctx.user.isSuperAdmin;
        if (!isAdmin) {
          const radar = await db.getActivePowerUpByName(viewer.id, "Radar");
          const canSeeAll = Boolean(radar || (game?.purgeActive && game.showLocationsDuringPurge));
          const vendetta = await db.getActivePowerUpByName(viewer.id, "Vendetta");
          const isMyTarget = target.id === viewer.targetId || target.id === vendetta?.targetPlayerId;
          if (!canSeeAll && !isMyTarget) {
            throw new Error("You can only check your current target's location, or everyone's during a purge");
          }
          const hiddenChecks = await Promise.all([
            db.getActivePowerUpByName(target.id, "Dead Zone"),
            db.getActivePowerUpByName(target.id, "Witness Protection"),
            radar ? db.getActivePowerUpByName(target.id, "Burner Phone") : Promise.resolve(undefined),
          ]);
          if (hiddenChecks.some(Boolean)) throw new Error("This player's location is currently hidden");
        }
        if (!target.latitude || !target.longitude) throw new Error("This player hasn't shared a location yet");
        const radarDetector = await db.getActivePowerUpByName(target.id, "Radar Detector");
        if (radarDetector) {
          await db.createNotification({
            userId: target.userId,
            gameId: input.gameId,
            type: "power_up_used",
            title: "📟 Someone Checked Your Location",
            body: "A player looked up your location on the map just now.",
          });
        }
        return { latitude: target.latitude, longitude: target.longitude };
      }),

    me: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getPlayerInGame(input.gameId, ctx.user.id);
      }),

    reconTarget: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const viewer = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!viewer || !viewer.targetId) return null;
        const recon = await db.getActivePowerUpByName(viewer.id, "Recon");
        if (!recon) return null;
        const players = await db.getGamePlayers(input.gameId);
        const target = players.find(p => p.id === viewer.targetId);
        if (!target) return null;
        const inventory = await db.getPlayerPowerUps(target.id);
        const active = inventory.filter(item => item.status === "active" && item.powerUp);
        return {
          targetName: target.user?.displayName || target.user?.name || `Player #${target.userId}`,
          points: target.points || 0,
          activePowerUps: active.map(item => ({
            name: item.powerUp!.name,
            emoji: item.powerUp!.emoji,
            expiresAt: item.expiresAt,
          })),
          expiresAt: recon.expiresAt,
        };
      }),

    vendettaTarget: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const viewer = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!viewer) return null;
        const vendetta = await db.getActivePowerUpByName(viewer.id, "Vendetta");
        if (!vendetta?.targetPlayerId) return null;
        const target = await db.getPlayerById(vendetta.targetPlayerId);
        if (!target || !target.latitude || !target.longitude) return null;
        return {
          id: target.id,
          userId: target.userId,
          latitude: target.latitude,
          longitude: target.longitude,
          status: target.status,
          expiresAt: vendetta.expiresAt,
        };
      }),

    update: protectedProcedure
      .input(z.object({
        playerId: z.number(),
        status: z.enum(["alive", "eliminated", "safe"]).optional(),
        hasPaid: z.boolean().optional(),
        points: z.number().optional(),
        targetId: z.number().optional(),
        partnerId: z.number().optional(),
        teamId: z.number().optional(),
        currentSafeObject: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { playerId, ...data } = input;
        await db.updatePlayer(playerId, data);
        return { success: true };
      }),

    updateLocation: protectedProcedure
      .input(z.object({ gameId: z.number(), latitude: z.string(), longitude: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        await db.updatePlayer(player.id, { latitude: input.latitude, longitude: input.longitude, locationUpdatedAt: new Date(), locationEnabled: true });
        return { success: true };
      }),

    disableLocation: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        await db.updatePlayer(player.id, { locationEnabled: false });
        // Notify admin
        const game = await db.getGame(input.gameId);
        if (game) {
          const playerName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || `Player #${ctx.user.id}`;
          await db.createNotification({ userId: game.adminId, gameId: input.gameId, type: "location_disabled", title: "⚠️ Location Disabled", body: `${playerName} has disabled their location.` });
          await db.createKillFeedEvent({ gameId: input.gameId, eventType: "location_disabled", actorId: player.id, message: `📍 A player has disabled their location!` });
        }
        return { success: true };
      }),

    revive: protectedProcedure
      .input(z.object({ playerId: z.number(), gameId: z.number() }))
      .mutation(async ({ input }) => {
        const revivedPlayer = await db.getPlayerById(input.playerId);
        await db.updatePlayer(input.playerId, { status: "alive" });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "revival", actorId: input.playerId, message: "❤️ A player has been revived!" });
        // Push notify the revived player
        if (revivedPlayer) {
          await sendPushToUser(revivedPlayer.userId, {
            title: "❤️ You've Been Revived!",
            body: "You're back in the game. Get hunting.",
            data: { type: "revival", gameId: input.gameId },
          });
        }
        return { success: true };
      }),
  }),

  bounty: router({
    board: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getBountyBoard(input.gameId);
      }),

    place: protectedProcedure
      .input(z.object({ gameId: z.number(), targetPlayerId: z.number(), amount: z.number().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        if ((player.points || 0) < input.amount) throw new Error("Not enough points");
        // Deduct points from placer
        await db.updatePlayer(player.id, { points: (player.points || 0) - input.amount });
        // Create bounty
        const id = await db.createBounty({ gameId: input.gameId, targetPlayerId: input.targetPlayerId, placedByPlayerId: player.id, amount: input.amount });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "bounty_placed", actorId: player.id, targetId: input.targetPlayerId, message: `🎯 A bounty of ${input.amount} points has been placed!` });
        // Notify the target player (in-app + push)
        const targetPlayer = await db.getPlayerById(input.targetPlayerId);
        if (targetPlayer) {
          await db.createNotification({ userId: targetPlayer.userId, gameId: input.gameId, type: "bounty", title: "💰 Bounty On Your Head!", body: `Someone placed a ${input.amount} point bounty on you. Watch your back.` });
          await sendPushToUser(targetPlayer.userId, {
            title: "💰 Bounty On Your Head!",
            body: `A ${input.amount} point bounty has been placed on you. Stay alert.`,
            data: { type: "bounty", gameId: input.gameId },
          });
        }
        // Auto-detect achievements after placing bounty
        await db.checkAndAwardAchievements(player.id, input.gameId);
        return { id };
      }),
  }),

  powerUp: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getGamePowerUps(input.gameId);
      }),

    create: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        name: z.string(),
        emoji: z.string(),
        effect: z.string(),
        cost: z.number(),
        usageFeeCents: z.number().int().min(0).default(0),
        duration: z.number().nullable().optional(),
        maxUsesPerGame: z.number().int().positive().nullable().optional(),
        category: z.enum(["offensive", "defensive", "utility", "special", "chaos"]).default("utility"),
        isEnabled: z.boolean().default(true),
        discount: z.number().default(0),
        description: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createPowerUp(input);
        return { id };
      }),

    seedAll: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        const defaultPowerUps: Array<{name:string;emoji:string;effect:string;cost:number;duration:number|null;maxUsesPerGame?:number;category:"offensive"|"defensive"|"utility"|"special"|"chaos";description:string}> = [
          // === OFFENSIVE (20) ===
          { name: "Bounty", emoji: "💰", effect: "Place bounty on any player (Hunter receives double the elimination points)", cost: 200, duration: 360, category: "offensive", description: "Place bounty on any player. The hunter who eliminates that player receives double the elimination points. Bounty lasts 6hrs. Your name is NOT revealed as the bounty placer." },
          { name: "Raise the Stakes", emoji: "📈", effect: "Double the existing bounty on any player (hunter receives double the elimination points)", cost: 350, duration: 180, category: "offensive", description: "Double the existing bounty on any player. The hunter who eliminates them receives double the elimination points. Lasts 3hrs. If no bounty exists, this places a standard bounty instead." },
          { name: "Killswitch", emoji: "💀", effect: "Strip all of the target's active power-ups (destroys ALL)", cost: 400, duration: null, category: "offensive", description: "Immediately deactivates ALL active power-ups on your current target. Shield? Gone. Ghost Mode? Disabled. Immunity Lock? Stripped. They receive a notification that their power-ups were stripped but NOT who did it." },
          { name: "Radar", emoji: "📡", effect: "Reveal all active players' locations on the map", cost: 100, duration: 120, category: "offensive", description: "For 2 hours, your map shows the real-time location of EVERY alive player, not just your target. Essentially a personal mini-purge without revealing your own location." },
          { name: "Recon", emoji: "🔍", effect: "See target's purchased power-ups and current point balance", cost: 150, duration: 120, category: "offensive", description: "Reveals your target's current point balance and all their active/purchased power-ups with remaining durations. Know if they have a Shield before you make your move. Lasts 2hrs." },
          { name: "Blacklist", emoji: "\u{1F6AB}", effect: "Block a target from buying power-ups", cost: 250, duration: 120, category: "offensive", description: "For 2 hours, your target cannot purchase power-ups from the shop. They can still use power-ups they already own." },
          { name: "Asset Freeze", emoji: "🧊", effect: "Block a target from using power-ups", cost: 250, duration: 120, category: "offensive", description: "For 2 hours, your target cannot activate or use power-ups they already own. They may still purchase power-ups." },
          { name: "Sabotage", emoji: "🔧", effect: "Target's next power-up purchase costs double", cost: 150, duration: 360, category: "offensive", description: "The next power-up your target purchases within 6 hours costs them double the listed price. They are NOT notified of the sabotage until they make the purchase and see the inflated cost." },
          { name: "Sniper's Duel", emoji: "🎯", effect: "Challenge any active player to a duel. Winner gets 100pts & can steal one power-up", cost: 50, duration: null, maxUsesPerGame: 1, category: "offensive", description: "Challenge any active player to a duel. Your opponent is notified they've been challenged — tell the admin in person. Once the admin picks a winner, both duelists are notified. Winner gets 100pts and can steal one of the loser's power-ups." },
          { name: "Jackpot", emoji: "✨", effect: "Next kill earns double points (1x per game)", cost: 300, duration: 1440, maxUsesPerGame: 1, category: "offensive", description: "Your next confirmed elimination earns double the normal elimination points. Stacks with bounty points. One-time use per game, lasts up to 24hrs until triggered." },
          { name: "Bounty Hunter", emoji: "🎯", effect: "Bonus points for next bounty you collect (Earns 450pts for 1 kill)", cost: 250, duration: 1440, maxUsesPerGame: 3, category: "offensive", description: "The next time you eliminate a player who has a bounty on them, you receive 450pts instead of the normal 300. One-time use, lasts up to 24hrs." },
          { name: "Vampire", emoji: "🧛", effect: "Gain 1 extra life for every kill in the time period (Max 3 lives / 1x per game)", cost: 350, duration: 120, maxUsesPerGame: 1, category: "offensive", description: "For 2 hours, each confirmed elimination grants you an automatic Revive token (max 3). As long as you keep killing, you can't stay dead. One-time use per game." },
          { name: "Smoke Screen", emoji: "💨", effect: "Hide all map power-up pickups from every active player", cost: 150, duration: 120, category: "offensive", description: "For 2 hours, ALL hidden map power-ups become invisible to every player except you. You can collect them freely while others can't even see they exist." },
          { name: "Vendetta", emoji: "⚔️", effect: "Add a second target for the duration", cost: 200, duration: 120, category: "offensive", description: "Choose any player to add as a second target. For 2 hours, you have two active targets at once and can see the extra target's location. Reverts to your normal single target when it expires." },
          { name: "Blackout", emoji: "⚫", effect: "Remove all player locations from the map for certain time period", cost: 300, duration: 120, category: "offensive", description: "For 2 hours, NO player locations are visible on anyone's map. Even during purge, the map goes dark. Everyone is notified when Blackout starts and ends." },
          { name: "Fall Guy", emoji: "🪖", effect: "Force someone to be your bodyguard, if you're shot, they're eliminated (1x per game)", cost: 300, duration: 240, maxUsesPerGame: 1, category: "offensive", description: "Force any alive player to be your human shield for 4 hours. If someone eliminates you during this time, the conscripted player is eliminated INSTEAD. They are notified. 1x per game." },
          { name: "Hitman's Cut", emoji: "💎", effect: "Get half the points from any kills achieved while active", cost: 250, duration: 240, maxUsesPerGame: 2, category: "offensive", description: "For 4 hours, whenever ANY player eliminates someone, you receive 50% of their earned points (bonus points generated, not taken from them). Passive income." },
          { name: "Frame Job", emoji: "🖼️", effect: "Transfer your bounty to someone else, if they're eliminated your bounty is fulfilled", cost: 250, duration: null, maxUsesPerGame: 1, category: "offensive", description: "Transfer all bounties currently on you to another player. The bounty stays on them for as long as it would have stayed on you — it does not expire on its own or transfer back." },
          { name: "Strip Search", emoji: "🔓", effect: "Remove your target's immunity shield for 2hrs", cost: 200, duration: 120, category: "offensive", description: "Immediately removes your current target's active Immunity Shield or Shield power-up for 2 hours. They are notified their shield was stripped but not by whom." },
          { name: "Boomerang", emoji: "🪃", effect: "Choose a player — if you're eliminated while active, your elimination boomerangs onto them instead", cost: 350, duration: 180, maxUsesPerGame: 1, category: "offensive", description: "Choose any active player when you activate this. For 3 hours, if anyone eliminates you, the elimination boomerangs back — instead of you, your chosen player is eliminated. They are not warned." },
          // === DEFENSIVE (15) ===
          { name: "Immunity Shield", emoji: "🛡️", effect: "Immunity from elimination while active", cost: 200, duration: 240, category: "defensive", description: "Activates a protective barrier. While active, any elimination attempt against you automatically fails. The attacker is NOT notified. Lasts 4 hours." },
          { name: "Dead Zone", emoji: "👻", effect: "Hide location from the map while active", cost: 150, duration: 120, category: "defensive", description: "Your location completely disappears from all maps for 2 hours — nothing is shown, not even a last-known pin. Great for ambushes or escaping hunters." },
          { name: "Clean Slate", emoji: "🧹", effect: "Remove a bounty placed on you", cost: 400, duration: null, maxUsesPerGame: 1, category: "defensive", description: "Instantly removes ALL active bounties placed on you. The bounty points vanish. Use when your bounty is climbing and you want to reduce incentive for others to target you." },
          { name: "Radar Detector", emoji: "📟", effect: "Get notified when someone checks your location on the map", cost: 125, duration: 240, category: "defensive", description: "For 4 hours, you receive a push notification any time another player views your location on the map. You'll know their name and the exact time." },
          { name: "Revive", emoji: "❤️", effect: "Come back to life after an elimination within 2hrs. Must be used in the same round. (1x per game)", cost: 350, duration: null, maxUsesPerGame: 1, category: "defensive", description: "Come back to life after an elimination. Must be used in the round the elimination occurred and within 2 hours of the elimination. One-time use per game." },
          { name: "Untouchable", emoji: "🔒", effect: "24hr Immunity (Only 1x per game; not usable during a purge)", cost: 500, duration: 1440, maxUsesPerGame: 1, category: "defensive", description: "Grants 24-hour immunity. May only be used once per game and may not be used during a purge." },
          { name: "Lucky Charm", emoji: "🍀", effect: "Auto-revive if you're eliminated while active", cost: 400, duration: 10080, maxUsesPerGame: 3, category: "defensive", description: "Stays active until used. If you're eliminated while it's active, the elimination still counts for your attacker, but you're instantly revived — no re-entry fee. Up to 3 per game." },
          { name: "Decoy", emoji: "🎭", effect: "Drop a fake location marker that others think is you", cost: 100, duration: 120, category: "defensive", description: "Places a fake GPS marker at a location you choose. For 2 hours, anyone tracking you sees the decoy location instead of your real one. Set it and move." },
          { name: "Doppleganger", emoji: "📌", effect: "Swap map location with any active player", cost: 100, duration: 120, category: "defensive", description: "For 2 hours, swap your displayed map location with any active player." },
          { name: "Mirror, Mirror", emoji: "🪞", effect: "Steal power of someone else's active power-up and get effects applied to you", cost: 250, duration: 120, category: "defensive", description: "Copy the effects of another player's active power-up onto yourself for 2 hours. The original player keeps their power-up. You get the same benefits." },
          { name: "Bodyguard", emoji: "💪", effect: "Give another player protection. If they get shot you lose 150pts. (1x per game)", cost: 50, duration: 180, maxUsesPerGame: 1, category: "defensive", description: "Assign protection to any player for 3 hours. While protected, elimination attempts against them fail. If they are eliminated, you lose 150pts. One-time use per game and not usable during a purge." },
          { name: "Respawn", emoji: "🔄", effect: "Undo your elimination, must pay half revival fee. Within 1hr of approval", cost: 350, duration: null, maxUsesPerGame: 1, category: "defensive", description: "If eliminated, activate within 1 hour of elimination approval. You return to alive status immediately. A half revival fee is added to the admin's fee queue for you to pay." },
          { name: "Witness Protection", emoji: "🕶️", effect: "Temporary safety from elimination and location removed from map", cost: 250, duration: 240, category: "defensive", description: "For 4 hours, you cannot be eliminated and your location is removed from the map. You cannot attack during this time." },
          { name: "Sanctuary", emoji: "⛪", effect: "Mark a safe zone for admin approval. Once approved, it shows on the map for 6hrs. (1x per game)", cost: 200, duration: 360, maxUsesPerGame: 1, category: "defensive", description: "Mark your current location or type an address for your sanctuary. The admin must approve it before it becomes a safe zone shown on everyone's map. Once approved it lasts 6hrs. One-time use per game and not usable during a purge." },
          { name: "Burner Phone", emoji: "📱", effect: "Blocks Radar from finding you (your own hunter can still see you)", cost: 150, duration: 240, category: "defensive", description: "For 4 hours, players using Radar cannot locate you. Your own hunter can still see you normally, and you can still see map power-ups." },
          // === CHAOS (9) ===
          { name: "Monkey Wrench", emoji: "🔀", effect: "Swap safe object for all players", cost: 100, duration: 1440, category: "chaos", description: "Changes the safe object for all players for 24 hours." },
          { name: "Reassignment", emoji: "🔄", effect: "Swap targets with another player's hunter", cost: 300, duration: null, maxUsesPerGame: 2, category: "chaos", description: "Choose any alive player to become your new target. Whoever currently hunts that player receives your old target in exchange. Use when your current target is too difficult." },
          { name: "Pickpocket", emoji: "🪙", effect: "Drain half the current points from a target & add to your score (Max 400)", cost: 250, duration: null, maxUsesPerGame: 3, category: "chaos", description: "Steals half the points from your current target (max 400pts) and adds them to your balance. They receive a notification they were robbed but not by whom." },
          { name: "Freaky Friday", emoji: "🎭", effect: "Swap ALL players' targets at once for remainder of the round", cost: 600, duration: null, maxUsesPerGame: 2, category: "chaos", description: "The ultimate chaos power-up. EVERY player in the game gets randomly reassigned a new target simultaneously. Everyone is notified. Creates total confusion and resets all strategies." },
          { name: "Lifeline", emoji: "🚑", effect: "Revive one eliminated player, must be used in same round (2x max per game)", cost: 400, duration: null, maxUsesPerGame: 2, category: "chaos", description: "Bring back one eliminated player of your choice from the current round. Can be used 2x max per game. The revived player owes you nothing." },
          { name: "Care package", emoji: "🎁", effect: "Gift any power-up you own to any other player", cost: 50, duration: null, category: "chaos", description: "Transfer any unused power-up from your inventory to another player. The recipient is notified who sent it. Useful for alliances or generosity." },
          { name: "Open Season", emoji: "🔫", effect: "Eliminate any player, no safe objects. +50pts for every elimination in the game while active", cost: 600, duration: 30, category: "chaos", description: "All players are notified immediately. After a 5-minute warning, Open Season is active for 30 minutes — anyone can eliminate anyone. You earn +50pts for every elimination that happens in the game while it's active, plus your normal kill points if you get one yourself." },
          { name: "Roulette", emoji: "🎰", effect: "Spin for random power-ups, discounts and points", cost: 50, duration: null, category: "chaos", description: "Spin the wheel! Possible outcomes set by admin: free power-up, point bonus, point penalty, discount coupon, or nothing. Cheap gamble that could pay off big or cost you." },
          { name: "Wildcard", emoji: "🃏", effect: "Choose your target for the next round", cost: 300, duration: null, maxUsesPerGame: 3, category: "chaos", description: "Choose which active player will be your target for the next round." },
        ];
        const ids: number[] = [];
        const usageFeesByName: Record<string, number> = {
          "Bounty": 500,
          "Raise the Stakes": 1000,
          "Clean Slate": 500,
          "Revive": 1500,
          "Respawn": 750,
          "Witness Protection": 500,
          "Sanctuary": 500,
          "Untouchable": 500,
          "Lifeline": 500,
          "Wildcard": 500,
        };
        for (const pu of defaultPowerUps) {
          const id = await db.createPowerUp({ ...pu, usageFeeCents: usageFeesByName[pu.name] || 0, gameId: input.gameId, isEnabled: true, discount: 0 });
          ids.push(id);
        }
        return { count: ids.length, ids };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        cost: z.number().optional(),
        usageFeeCents: z.number().int().min(0).optional(),
        isEnabled: z.boolean().optional(),
        discount: z.number().optional(),
        duration: z.number().nullable().optional(),
        maxUsesPerGame: z.number().int().positive().nullable().optional(),
        description: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updatePowerUp(id, data);
        return { success: true };
      }),

    purchase: protectedProcedure
      .input(z.object({ gameId: z.number(), powerUpId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        const allPowerUps = await db.getGamePowerUps(input.gameId);
        const powerUp = allPowerUps.find(p => p.id === input.powerUpId);
        if (!powerUp || !powerUp.isEnabled) throw new Error("Power-up not available");
        if (powerUp.maxUsesPerGame != null) {
          const usageCount = await db.getPlayerPowerUpUsageCount(player.id, powerUp.id, input.gameId);
          if (usageCount >= powerUp.maxUsesPerGame) {
            throw new Error(`You've already used the maximum of ${powerUp.maxUsesPerGame} for this power-up this game`);
          }
        }
        await db.expirePlayerPowerUps(input.gameId);
        const blacklist = await db.getActiveTargetedPowerUp(input.gameId, player.id, "Blacklist");
        if (blacklist) throw new Error("You are currently blacklisted and cannot purchase power-ups");
        const sabotage = await db.getActiveTargetedPowerUp(input.gameId, player.id, "Sabotage");
        const baseCost = powerUp.discount ? Math.floor(powerUp.cost * (1 - powerUp.discount / 100)) : powerUp.cost;
        const standardCost = sabotage ? baseCost * 2 : baseCost;
        const pendingDiscountPercent = player.pendingDiscountPercent;
        const cost = pendingDiscountPercent == null
          ? standardCost
          : Math.floor(standardCost * (1 - pendingDiscountPercent / 100));
        if ((player.points || 0) < cost) throw new Error("Not enough points");
        await db.updatePlayer(player.id, {
          points: (player.points || 0) - cost,
          ...(pendingDiscountPercent == null ? {} : { pendingDiscountPercent: null }),
        });
        const inventoryId = await db.purchasePowerUp(player.id, powerUp.id, input.gameId);
        if (sabotage) await db.consumePlayerPowerUp(sabotage.id);
        await db.checkAndAwardAchievements(player.id, input.gameId);
        return { success: true, inventoryId, cost, status: "inventory" as const };
      }),

    inventory: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) return [];
        await db.expirePlayerPowerUps(input.gameId);
        return db.getPlayerPowerUps(player.id);
      }),

    // Kept for compatibility with existing profile clients.
    playerActive: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) return [];
        await db.expirePlayerPowerUps(input.gameId);
        const inventory = await db.getPlayerPowerUps(player.id);
        return inventory.filter(item => item.status === "active");
      }),

    activate: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        inventoryId: z.number(),
        targetPlayerId: z.number().optional(),
        activationData: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        const item = await db.getPlayerPowerUpById(input.inventoryId);
        if (!item || item.gamePlayerId !== player.id || item.gameId !== input.gameId) throw new Error("Inventory item not found");
        if (!item.powerUp) throw new Error("Power-up definition not found");
        if (!["inventory", "pending_payment"].includes(item.status)) throw new Error("This power-up is not available to activate");
        await db.expirePlayerPowerUps(input.gameId);

        const assetFreeze = await db.getActiveTargetedPowerUp(input.gameId, player.id, "Asset Freeze");
        if (assetFreeze) throw new Error("Your power-up inventory is currently frozen");

        const requiresFinalRuleDesign = new Set(["Roulette"]);
        if (requiresFinalRuleDesign.has(item.powerUp.name)) {
          throw new Error(`${item.powerUp.name} is in your inventory, but its final game rule must be configured before activation`);
        }

        if ((item.powerUp.usageFeeCents || 0) > 0) {
          const fee = await db.getPowerUpUsageFee(item.id);
          if (!fee) {
            const feeId = await db.createPowerUpUsageFee({
              gameId: input.gameId,
              gamePlayerId: player.id,
              playerPowerUpId: item.id,
              amountCents: item.powerUp.usageFeeCents || 0,
              status: "pending",
            });
            await db.setPlayerPowerUpPendingPayment(item.id);
            return { success: false, paymentRequired: true, feeId, amountCents: item.powerUp.usageFeeCents || 0 };
          }
          if (fee.status === "pending") return { success: false, paymentRequired: true, feeId: fee.id, amountCents: fee.amountCents };
        }

        const targetRequired = new Set([
          "Bounty", "Raise the Stakes", "Killswitch", "Recon", "Blacklist", "Asset Freeze", "Sabotage",
          "Sniper's Duel", "Fall Guy", "Frame Job", "Strip Search", "Doppleganger", "Mirror, Mirror", "Bodyguard", "Pickpocket",
          "Lifeline", "Care package", "Wildcard", "Vendetta", "Reassignment", "Boomerang"
        ]);
        if (targetRequired.has(item.powerUp.name) && !input.targetPlayerId) throw new Error("Choose a target before activating this power-up");
        if (input.targetPlayerId) {
          const target = await db.getPlayerById(input.targetPlayerId);
          if (!target || target.gameId !== input.gameId) throw new Error("Invalid target player");
        }

        const game = await db.getGame(input.gameId);
        if (["Untouchable", "Bodyguard", "Sanctuary"].includes(item.powerUp.name) && game?.purgeActive) {
          throw new Error(`${item.powerUp.name} cannot be activated during a purge`);
        }

        let consumeImmediately = item.powerUp.duration == null;
        let finalActivationData: Record<string, unknown> | undefined = input.activationData;
        let effectiveDurationMinutes: number | null = item.powerUp.duration;
        switch (item.powerUp.name) {
          case "Open Season": {
            const effectStartsAt = new Date(Date.now() + 5 * 60000);
            finalActivationData = { ...(input.activationData || {}), effectStartsAt: effectStartsAt.toISOString() };
            effectiveDurationMinutes = (item.powerUp.duration || 30) + 5;
            const allPlayers = await db.getGamePlayers(input.gameId);
            for (const gamePlayer of allPlayers) {
              await db.createNotification({
                userId: gamePlayer.userId,
                gameId: input.gameId,
                type: "power_up_used",
                title: "🔫 Open Season Incoming!",
                body: "Open Season activates in 5 minutes. No safe objects will protect anyone once it starts.",
              });
            }
            break;
          }
          case "Sniper's Duel": {
            if (!input.targetPlayerId) throw new Error("Choose an opponent before activating this power-up");
            const duelId = await db.createDuel({ gameId: input.gameId, challengerId: player.id, opponentId: input.targetPlayerId });
            const opponent = await db.getPlayerById(input.targetPlayerId);
            if (opponent) {
              await db.createNotification({
                userId: opponent.userId,
                gameId: input.gameId,
                type: "power_up_used",
                title: "🎯 You've Been Challenged!",
                body: "A player has challenged you to a Sniper's Duel. Let the admin know so they can pick a winner.",
              });
            }
            finalActivationData = { ...(input.activationData || {}), duelId };
            break;
          }
          case "Sanctuary": {
            const requestedLat = typeof input.activationData?.zoneLatitude === "string" ? input.activationData.zoneLatitude : undefined;
            const requestedLng = typeof input.activationData?.zoneLongitude === "string" ? input.activationData.zoneLongitude : undefined;
            const zoneLatitude = requestedLat || player.latitude;
            const zoneLongitude = requestedLng || player.longitude;
            if (!zoneLatitude || !zoneLongitude) {
              throw new Error("Enable your location, mark a spot on the map, or enter an address before declaring a Sanctuary");
            }
            finalActivationData = {
              zoneLatitude,
              zoneLongitude,
              zoneRadiusMeters: 30,
              approved: false,
            };
            if (game?.adminId) {
              await db.createNotification({
                userId: game.adminId,
                gameId: input.gameId,
                type: "power_up_used",
                title: "⛪ Sanctuary Approval Needed",
                body: `A player requested a Sanctuary at ${zoneLatitude}, ${zoneLongitude}. Approve it in Admin > Eliminations to show it on the map.`,
              });
            }
            break;
          }
          case "Decoy": {
            if (!player.latitude || !player.longitude) {
              throw new Error("Enable your location before using Decoy");
            }
            const realLat = parseFloat(player.latitude);
            const realLng = parseFloat(player.longitude);
            // Random offset roughly 100-300 meters away in a random direction
            const angle = Math.random() * 2 * Math.PI;
            const distanceDegrees = (0.001 + Math.random() * 0.002);
            const decoyLatitude = (realLat + Math.cos(angle) * distanceDegrees).toFixed(6);
            const decoyLongitude = (realLng + Math.sin(angle) * distanceDegrees).toFixed(6);
            finalActivationData = { ...(input.activationData || {}), decoyLatitude, decoyLongitude };
            break;
          }
          case "Bounty":
            await db.createBounty({
              gameId: input.gameId,
              targetPlayerId: input.targetPlayerId!,
              placedByPlayerId: player.id,
              amount: (game?.eliminationPoints || 100) * 2,
            });
            break;
          case "Raise the Stakes":
            await db.doublePlayerBounties(input.gameId, input.targetPlayerId!, player.id);
            break;
          case "Killswitch":
            await db.deactivateAllPlayerPowerUps(input.targetPlayerId!);
            break;
          case "Clean Slate":
            await db.clearPlayerBounties(input.gameId, player.id);
            break;
          case "Witness Protection":
            await db.updatePlayer(player.id, { status: "safe" });
            break;
          case "Strip Search": {
            if (input.targetPlayerId !== player.targetId) {
              throw new Error("Strip Search can only be used on your current target");
            }
            const immunity = await db.getActivePowerUpByName(input.targetPlayerId!, "Immunity Shield");
            if (!immunity) throw new Error("The selected player has no active Immunity Shield");
            await db.consumePlayerPowerUp(immunity.id);
            break;
          }
          case "Frame Job":
            await db.transferPlayerBounties(input.gameId, player.id, input.targetPlayerId!);
            break;
          case "Mirror, Mirror": {
            const targetInventory = await db.getPlayerPowerUps(input.targetPlayerId!);
            const copied = targetInventory.find(candidate => candidate.status === "active" && candidate.powerUp?.name !== "Mirror, Mirror");
            if (!copied?.powerUp) throw new Error("The selected player has no active power-up to copy");
            const copiedInventoryId = await db.purchasePowerUp(player.id, copied.powerUp.id, input.gameId);
            await db.activatePlayerPowerUp(copiedInventoryId, {
              expiresAt: copied.expiresAt,
              targetPlayerId: copied.targetPlayerId,
              activationData: { copiedBy: item.id },
            });
            break;
          }
          case "Revive": {
            const latest = await db.getLatestApprovedEliminationForPlayer(input.gameId, player.id);
            if (!latest || latest.round !== (game?.currentRound || 1) || !latest.reviewedAt || Date.now() - latest.reviewedAt.getTime() > 2 * 60 * 60 * 1000) {
              throw new Error("Revive must be used within 2 hours of an elimination in the current round");
            }
            await db.updatePlayer(player.id, { status: "alive" });
            break;
          }
          case "Respawn": {
            const latest = await db.getLatestApprovedEliminationForPlayer(input.gameId, player.id);
            if (!latest || !latest.reviewedAt || Date.now() - latest.reviewedAt.getTime() > 60 * 60 * 1000) {
              throw new Error("Respawn must be used within 1 hour of elimination approval");
            }
            await db.updatePlayer(player.id, { status: "alive" });
            break;
          }
          case "Pickpocket": {
            const target = await db.getPlayerById(input.targetPlayerId!);
            if (!target) throw new Error("Target not found");
            const stolen = Math.min(400, Math.floor((target.points || 0) / 2));
            await db.updatePlayer(target.id, { points: (target.points || 0) - stolen });
            await db.updatePlayer(player.id, { points: (player.points || 0) + stolen });
            break;
          }
          case "Reassignment": {
            const newTarget = await db.getPlayerById(input.targetPlayerId!);
            if (!newTarget || newTarget.gameId !== input.gameId || newTarget.status !== "alive") {
              throw new Error("Choose an alive player as your new target");
            }
            if (newTarget.id === player.id) throw new Error("You can't target yourself");
            const allPlayers = await db.getGamePlayers(input.gameId);
            const newTargetHunter = allPlayers.find(p => p.targetId === newTarget.id && p.id !== player.id);
            const oldTargetId = player.targetId;
            await db.updatePlayer(player.id, { targetId: newTarget.id });
            if (newTargetHunter && oldTargetId) {
              await db.updatePlayer(newTargetHunter.id, { targetId: oldTargetId });
            }
            break;
          }
          case "Freaky Friday": {
            const alive = (await db.getGamePlayers(input.gameId)).filter(p => p.status === "alive");
            const shuffled = [...alive].sort(() => Math.random() - 0.5);
            for (let index = 0; index < alive.length; index++) {
              let target = shuffled[index];
              if (target.id === alive[index].id) target = shuffled[(index + 1) % shuffled.length];
              if (target && target.id !== alive[index].id) await db.updatePlayer(alive[index].id, { targetId: target.id });
            }
            break;
          }
          case "Monkey Wrench": {
            const safeObject = String(input.activationData?.safeObject || "").trim();
            if (!safeObject) throw new Error("Choose the replacement safe object");
            await db.updateGame(input.gameId, { safeObject });
            const players = await db.getGamePlayers(input.gameId);
            for (const gamePlayer of players) await db.updatePlayer(gamePlayer.id, { currentSafeObject: safeObject });
            break;
          }
          case "Lifeline":
            await db.updatePlayer(input.targetPlayerId!, { status: "alive" });
            break;
          case "Wildcard":
            await db.updatePlayer(player.id, { nextRoundTargetId: input.targetPlayerId! });
            break;
          case "Care package": {
            const giftInventoryId = Number(input.activationData?.giftInventoryId);
            if (!giftInventoryId || giftInventoryId === item.id) throw new Error("Choose an inventory item to gift");
            const gift = await db.getPlayerPowerUpById(giftInventoryId);
            if (!gift || gift.gamePlayerId !== player.id || gift.status !== "inventory") throw new Error("Gift item is not available");
            await db.transferPlayerPowerUp(gift.id, input.targetPlayerId!);
            break;
          }
        }

        if (consumeImmediately) {
          await db.consumePlayerPowerUp(item.id);
        } else {
          const expiresAt = new Date(Date.now() + effectiveDurationMinutes! * 60000);
          await db.activatePlayerPowerUp(item.id, { expiresAt, targetPlayerId: input.targetPlayerId, activationData: finalActivationData });
        }
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: player.id, targetId: input.targetPlayerId, message: `${item.powerUp.emoji} ${item.powerUp.name} activated!` });
        await db.checkAndAwardAchievements(player.id, input.gameId);
        return { success: true, paymentRequired: false, status: consumeImmediately ? "consumed" as const : "active" as const };
      }),

    pendingFees: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        return db.getGamePowerUpUsageFees(input.gameId);
      }),

    resolveFee: protectedProcedure
      .input(z.object({ feeId: z.number(), gameId: z.number(), status: z.enum(["paid", "waived"]), note: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        await db.resolvePowerUpUsageFee(input.feeId, input.status, ctx.user.id, input.note);
        return { success: true };
      }),

    pendingSanctuaries: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        return db.getPendingSanctuaryZones(input.gameId);
      }),

    approveSanctuary: protectedProcedure
      .input(z.object({ gameId: z.number(), inventoryId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const item = await db.getPlayerPowerUpById(input.inventoryId);
        if (!item || item.gameId !== input.gameId) throw new Error("Sanctuary request not found");
        const activationData = (item.activationData as Record<string, unknown> | null) || {};
        await db.updatePlayerPowerUpActivationData(item.id, { ...activationData, approved: true });
        const holder = await db.getPlayerById(item.gamePlayerId);
        if (holder) {
          await db.createNotification({ userId: holder.userId, gameId: input.gameId, type: "power_up_used", title: "⛪ Sanctuary Approved", body: "Your Sanctuary was approved and now shows as a safe zone on the map." });
        }
        return { success: true };
      }),
  }),

  elimination: router({
    submit: protectedProcedure
      .input(z.object({ gameId: z.number(), eliminatedId: z.number(), videoUrl: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        const game = await db.getGame(input.gameId);
        const id = await db.createElimination({
          gameId: input.gameId,
          eliminatorId: player.id,
          eliminatedId: input.eliminatedId,
          videoUrl: input.videoUrl,
          round: game?.currentRound || 1,
        });
        // Notify admin
        if (game) {
          await db.createNotification({ userId: game.adminId, gameId: input.gameId, type: "elimination_pending", title: "Elimination Pending", body: `A new elimination needs review.` });
        }
        return { id };
      }),

    pending: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getPendingEliminations(input.gameId);
      }),

    review: protectedProcedure
      .input(z.object({
        eliminationId: z.number(),
        gameId: z.number(),
        approved: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        let approved = input.approved;
        let submittedElimination = await db.getElimination(input.eliminationId);
        if (approved && submittedElimination) {
          await db.expirePlayerPowerUps(input.gameId);
          const fallGuy = await db.getActivePowerUpByName(submittedElimination.eliminatedId, "Fall Guy");
          if (fallGuy?.targetPlayerId) {
            await db.updateElimination(input.eliminationId, { eliminatedId: fallGuy.targetPlayerId });
            await db.consumePlayerPowerUp(fallGuy.id);
            submittedElimination = await db.getElimination(input.eliminationId);
          }
          if (submittedElimination) {
            const boomerang = await db.getActivePowerUpByName(submittedElimination.eliminatedId, "Boomerang");
            if (boomerang && boomerang.targetPlayerId) {
              const boomerangHolderId = submittedElimination.eliminatedId;
              await db.updateElimination(input.eliminationId, { eliminatorId: boomerangHolderId, eliminatedId: boomerang.targetPlayerId });
              await db.consumePlayerPowerUp(boomerang.id);
              submittedElimination = await db.getElimination(input.eliminationId);
            }
          }
          if (submittedElimination) {
            const bodyguard = await db.getActiveTargetedPowerUp(input.gameId, submittedElimination.eliminatedId, "Bodyguard");
            if (bodyguard) {
              approved = false;
              const bodyguardPlayer = await db.getPlayerById(bodyguard.gamePlayerId);
              if (bodyguardPlayer) await db.updatePlayer(bodyguardPlayer.id, { points: Math.max(0, (bodyguardPlayer.points || 0) - 150) });
              await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: bodyguard.gamePlayerId, targetId: submittedElimination.eliminatedId, message: "Bodyguard blocked an elimination!" });
            }
          }
          if (submittedElimination) {
            const defendedPlayerId = submittedElimination.eliminatedId;
            const protectionNames = ["Immunity Shield", "Untouchable", "Witness Protection"];
            for (const protectionName of approved ? protectionNames : []) {
              const protection = await db.getActivePowerUpByName(defendedPlayerId, protectionName);
              if (protection) {
                approved = false;
                await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: defendedPlayerId, message: `${protectionName} blocked an elimination!` });
                break;
              }
            }
          }
        }
        const status = approved ? "approved" : "denied";
        const game = await db.getGame(input.gameId);
        const eliminationPoints = (game?.purgeActive ? game?.purgeEliminationPoints : null) ?? game?.eliminationPoints ?? 100;
        await db.updateElimination(input.eliminationId, { status, reviewedBy: ctx.user.id, reviewedAt: new Date(), pointsAwarded: approved ? eliminationPoints : 0 });
        
        if (approved) {
          const elim = await db.getElimination(input.eliminationId);
          if (elim) {
            // Award points to eliminator
            const players = await db.getGamePlayers(input.gameId);
            const eliminator = players.find(p => p.id === elim.eliminatorId);
            const eliminated = players.find(p => p.id === elim.eliminatedId);
            if (eliminator) {
              let killPoints = eliminationPoints;
              const jackpot = await db.getActivePowerUpByName(eliminator.id, "Jackpot");
              if (jackpot) {
                killPoints *= 2;
                await db.consumePlayerPowerUp(jackpot.id);
              }
              let totalAward = killPoints;
              // Claim any bounties on the eliminated player
              if (eliminated) {
                const bountyTotal = eliminated.bountyPoints || 0;
                if (bountyTotal > 0) {
                  let bountyAward = bountyTotal;
                  const bountyHunter = await db.getActivePowerUpByName(eliminator.id, "Bounty Hunter");
                  if (bountyHunter) {
                    bountyAward = 450;
                    await db.consumePlayerPowerUp(bountyHunter.id);
                  }
                  await db.claimBounties(input.gameId, eliminated.id, eliminator.id);
                  totalAward += bountyAward;
                  await db.createKillFeedEvent({ gameId: input.gameId, eventType: "bounty_claimed", actorId: eliminator.id, targetId: eliminated.id, message: `💰 Bounty of ${bountyAward} points claimed!` });
                }
              }
              await db.updatePlayer(eliminator.id, { points: (eliminator.points || 0) + totalAward, kills: (eliminator.kills || 0) + 1 });
              const vampire = await db.getActivePowerUpByName(eliminator.id, "Vampire");
              if (vampire) {
                const currentCredits = (eliminator as any).reviveCredits || 0;
                if (currentCredits < 3) {
                  await db.updatePlayer(eliminator.id, { reviveCredits: currentCredits + 1 } as any);
                  await db.createNotification({ userId: eliminator.userId, gameId: input.gameId, type: "power_up_used", title: "🧛 Vampire Charge Gained", body: `You now have ${currentCredits + 1} extra life/lives banked.` });
                }
              }
              const cuts = await db.getActiveGamePowerUpsByName(input.gameId, "Hitman's Cut");
              for (const cut of cuts) {
                if (cut.gamePlayerId === eliminator.id) continue;
                const beneficiary = players.find(p => p.id === cut.gamePlayerId);
                if (beneficiary) await db.updatePlayer(beneficiary.id, { points: (beneficiary.points || 0) + Math.floor(totalAward / 2) });
              }
              const openSeasonHolders = await db.getActiveGamePowerUpsByName(input.gameId, "Open Season");
              for (const holder of openSeasonHolders) {
                const holderData = holder.activationData as { effectStartsAt?: string } | null;
                const effectStartsAt = holderData?.effectStartsAt ? new Date(holderData.effectStartsAt).getTime() : 0;
                if (Date.now() < effectStartsAt) continue;
                const holderPlayer = await db.getPlayerById(holder.gamePlayerId);
                if (holderPlayer) await db.updatePlayer(holderPlayer.id, { points: (holderPlayer.points || 0) + 50 });
              }
              // Inherit target if enabled
              if (game?.inheritTarget && eliminated) {
                const inheritedTarget = eliminated.targetId;
                if (inheritedTarget && inheritedTarget !== eliminator.id) {
                  await db.updatePlayer(eliminator.id, { targetId: inheritedTarget });
                  await db.createNotification({ userId: eliminator.userId, gameId: input.gameId, type: "new_target", title: "New Target Assigned", body: "You've inherited your victim's target!" });
                }
              }
              // Notify eliminator (in-app + push)
              await db.createNotification({ userId: eliminator.userId, gameId: input.gameId, type: "elimination_approved", title: "Elimination Approved!", body: `+${eliminationPoints} points awarded.` });
              await sendPushToUser(eliminator.userId, {
                title: "✅ Elimination Approved!",
                body: `+${eliminationPoints} points awarded. Keep hunting.`,
                data: { type: "elimination_approved", gameId: input.gameId },
              });
            }
            if (eliminated) {
              const reviveCredits = (eliminated as any).reviveCredits || 0;
              const luckyCharm = await db.getActivePowerUpByName(eliminated.id, "Lucky Charm");
              if (reviveCredits > 0) {
                await db.updatePlayer(eliminated.id, { status: "alive", deaths: (eliminated.deaths || 0) + 1, reviveCredits: reviveCredits - 1 } as any);
                await db.createNotification({ userId: eliminated.userId, gameId: input.gameId, type: "elimination_result", title: "🧛 Vampire Saved You!", body: "You were eliminated, but an extra life brought you back instantly." });
                await sendPushToUser(eliminated.userId, {
                  title: "🧛 Extra Life Used!",
                  body: "You were eliminated but a banked Vampire life revived you instantly.",
                  data: { type: "vampire_revive", gameId: input.gameId },
                });
              } else if (luckyCharm) {
                await db.consumePlayerPowerUp(luckyCharm.id);
                await db.updatePlayer(eliminated.id, { status: "alive", deaths: (eliminated.deaths || 0) + 1 });
                await db.createNotification({ userId: eliminated.userId, gameId: input.gameId, type: "elimination_result", title: "🍀 Lucky Charm Saved You!", body: "You were eliminated, but your Lucky Charm revived you instantly." });
                await sendPushToUser(eliminated.userId, {
                  title: "🍀 Lucky Charm Saved You!",
                  body: "You were eliminated but your Lucky Charm brought you back instantly.",
                  data: { type: "lucky_charm_revive", gameId: input.gameId },
                });
              } else {
                await db.updatePlayer(eliminated.id, { status: "eliminated", deaths: (eliminated.deaths || 0) + 1 });
                await db.createNotification({ userId: eliminated.userId, gameId: input.gameId, type: "elimination_result", title: "You've Been Eliminated", body: "Better luck next round!" });
                // Push notify eliminated player
                await sendPushToUser(eliminated.userId, {
                  title: "💀 You've Been Eliminated",
                  body: "Your elimination has been confirmed. Better luck next round!",
                  data: { type: "eliminated", gameId: input.gameId },
                });
              }
            }
          }
          const approvedElimination = await db.getElimination(input.eliminationId);
          await db.createKillFeedEvent({
            gameId: input.gameId,
            eventType: "elimination_approved",
            actorId: approvedElimination?.eliminatorId ?? null,
            targetId: approvedElimination?.eliminatedId ?? null,
            message: "💀 Elimination confirmed!",
          });
          // Auto-detect achievements for eliminator after confirmed kill
          const elimForAchieve = await db.getElimination(input.eliminationId);
          if (elimForAchieve) {
            await db.checkAndAwardAchievements(elimForAchieve.eliminatorId, input.gameId);
          }
        } else {
          await db.createKillFeedEvent({ gameId: input.gameId, eventType: "elimination_denied", message: "❌ Elimination denied." });
          // Notify the submitter
          const elim = await db.getElimination(input.eliminationId);
          if (elim) {
            const players = await db.getGamePlayers(input.gameId);
            const eliminator = players.find(p => p.id === elim.eliminatorId);
            if (eliminator) {
              await db.createNotification({ userId: eliminator.userId, gameId: input.gameId, type: "elimination_denied", title: "Elimination Denied", body: "Your elimination submission was not approved." });
              // Push notify denied
              await sendPushToUser(eliminator.userId, {
                title: "❌ Elimination Denied",
                body: "Your submission was not approved. Try again.",
                data: { type: "elimination_denied", gameId: input.gameId },
              });
            }
          }
        }
        return { success: true };
      }),

    uploadVideo: protectedProcedure
      .input(z.object({ gameId: z.number(), fileName: z.string(), fileBase64: z.string(), contentType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const key = `eliminations/${input.gameId}/${ctx.user.id}-${Date.now()}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.contentType);
        return { url };
      }),
  }),

  duel: router({
    pending: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        return db.getPendingDuels(input.gameId);
      }),

    resolve: protectedProcedure
      .input(z.object({ gameId: z.number(), duelId: z.number(), winnerId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const result = await db.resolveDuel(input.duelId, input.winnerId);
        const winner = await db.getPlayerById(result.winnerId);
        const loser = await db.getPlayerById(result.loserId);
        if (winner) {
          await db.createNotification({ userId: winner.userId, gameId: input.gameId, type: "power_up_used", title: "🎯 You Won the Duel!", body: `+100 points${result.stoleItem ? " and you stole a power-up" : ""}.` });
        }
        if (loser) {
          await db.createNotification({ userId: loser.userId, gameId: input.gameId, type: "power_up_used", title: "You Lost the Duel", body: "Better luck next time." });
        }
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: result.winnerId, targetId: result.loserId, message: "🎯 Sniper's Duel resolved!" });
        return { success: true };
      }),
  }),

  killFeed: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number(), limit: z.number().default(50) }))
      .query(async ({ input }) => {
        return db.getKillFeed(input.gameId, input.limit);
      }),
  }),

  notification: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserNotifications(ctx.user.id);
    }),

    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.markNotificationRead(input.id);
        return { success: true };
      }),

    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markAllNotificationsRead(ctx.user.id);
      return { success: true };
    }),
  }),

  achievement: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getGameAchievements(input.gameId);
      }),

    create: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        name: z.string(),
        description: z.string().optional(),
        emoji: z.string().optional(),
        pointsValue: z.number().default(0),
        condition: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createAchievement(input);
        return { id };
      }),

    award: protectedProcedure
      .input(z.object({ gamePlayerId: z.number(), achievementId: z.number(), gameId: z.number() }))
      .mutation(async ({ input }) => {
        await db.awardAchievement(input.gamePlayerId, input.achievementId);
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "achievement_earned", actorId: input.gamePlayerId, message: "🏅 Achievement unlocked!" });
        return { success: true };
      }),

    playerList: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) return [];
        return db.getPlayerAchievements(player.id);
      }),

    seedAll: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        const achievements = [
          // === COMBAT ACHIEVEMENTS ===
          { name: "First Blood", description: "Get your 1st elimination", emoji: "🩸", pointsValue: 50, condition: "lifetime_eliminations >= 1", achievementType: "combat", category: "Lifetime" },
          { name: "Public Menace", description: "Get 15 eliminations", emoji: "😈", pointsValue: 200, condition: "lifetime_eliminations >= 15", achievementType: "combat", category: "Lifetime" },
          { name: "Living Legend", description: "Get 25 eliminations", emoji: "🏆", pointsValue: 500, condition: "lifetime_eliminations >= 25", achievementType: "combat", category: "Lifetime" },
          { name: "Elimination God", description: "Get 50 eliminations", emoji: "💀", pointsValue: 750, condition: "lifetime_eliminations >= 50", achievementType: "combat", category: "Lifetime" },
          { name: "Wet Bandit", description: "Get 1st elimination of the game", emoji: "🔫", pointsValue: 150, condition: "game_first_elimination", achievementType: "combat", category: "Game" },
          { name: "Predator", description: "Get 5 eliminations in one game", emoji: "🦅", pointsValue: 250, condition: "game_eliminations >= 5", achievementType: "combat", category: "Game" },
          { name: "Apex Predator", description: "Get 10 eliminations in one game", emoji: "🦁", pointsValue: 500, condition: "game_eliminations >= 10", achievementType: "combat", category: "Game" },
          { name: "Sharpsquirter", description: "Get the 1st elimination of the round", emoji: "💧", pointsValue: 150, condition: "round_first_elimination", achievementType: "combat", category: "Round" },
          { name: "Serial Soaker", description: "Get 3 eliminations in one round", emoji: "🌊", pointsValue: 250, condition: "round_eliminations >= 3", achievementType: "combat", category: "Round" },
          { name: "Drip Queen", description: "Get 5 eliminations in one round", emoji: "👑", pointsValue: 500, condition: "round_eliminations >= 5", achievementType: "combat", category: "Round" },
          { name: "Cat Burglar", description: "Use 1 theft power-up in one game", emoji: "🐱", pointsValue: 200, condition: "game_theft_powerups >= 1", achievementType: "combat", category: "Game" },
          { name: "Master Thief", description: "Use 3 theft power-ups in one game", emoji: "🥷", pointsValue: 300, condition: "game_theft_powerups >= 3", achievementType: "combat", category: "Game" },
          { name: "Crime Boss", description: "Use 10+ power-ups in one game", emoji: "🤵", pointsValue: 500, condition: "game_powerups_used >= 10", achievementType: "combat", category: "Game" },
          { name: "Hit List", description: "Place a bounty on active player in one game", emoji: "📋", pointsValue: 200, condition: "game_bounties_placed >= 1", achievementType: "combat", category: "Game" },
          { name: "Bounty Broker", description: "Place 5 bounties on active player in one game", emoji: "💰", pointsValue: 300, condition: "game_bounties_placed >= 5", achievementType: "combat", category: "Game" },
          { name: "Crime Syndicate", description: "Place 10+ bounties on active player in one game", emoji: "🏦", pointsValue: 500, condition: "game_bounties_placed >= 10", achievementType: "combat", category: "Game" },
          { name: "Tracker", description: "Collect 1 bounty in one game", emoji: "🎯", pointsValue: 150, condition: "game_bounties_collected >= 1", achievementType: "combat", category: "Game" },
          { name: "Bounty Hunter", description: "Collect 5 bounties in one game", emoji: "🏹", pointsValue: 400, condition: "game_bounties_collected >= 5", achievementType: "combat", category: "Game" },
          { name: "Legend Hunter", description: "Collect 10+ bounties in one game", emoji: "⚔️", pointsValue: 650, condition: "game_bounties_collected >= 10", achievementType: "combat", category: "Game" },
          { name: "Killing Spree", description: "Get 3 eliminations without dying in one game", emoji: "🔥", pointsValue: 250, condition: "game_kill_streak >= 3", achievementType: "combat", category: "Game" },
          { name: "Rampage", description: "Get 5 eliminations without dying in one game", emoji: "💥", pointsValue: 500, condition: "game_kill_streak >= 5", achievementType: "combat", category: "Game" },
          { name: "One Man Army", description: "Get 10+ eliminations in one game without dying", emoji: "🪖", pointsValue: 750, condition: "game_kill_streak >= 10", achievementType: "combat", category: "Game" },
          { name: "No Mercy", description: "Eliminate 3 players during open season or a purge", emoji: "😤", pointsValue: 250, condition: "purge_eliminations >= 3", achievementType: "combat", category: "Game" },
          { name: "Grudge Match", description: "Eliminate 5 players during open season or a purge", emoji: "😡", pointsValue: 500, condition: "purge_eliminations >= 5", achievementType: "combat", category: "Game" },
          { name: "Uno Reverse", description: "Eliminate any of your previous or current hunters during a purge", emoji: "🔄", pointsValue: 150, condition: "purge_hunter_elimination", achievementType: "combat", category: "Game" },
          // === SURVIVAL ACHIEVEMENTS ===
          { name: "Dry as a Bone", description: "Survive 3 consecutive rounds", emoji: "🦴", pointsValue: 75, condition: "consecutive_rounds_survived >= 3", achievementType: "survival", category: "Game" },
          { name: "Untouchable", description: "Survive 5 consecutive rounds", emoji: "🛡️", pointsValue: 125, condition: "consecutive_rounds_survived >= 5", achievementType: "survival", category: "Game" },
          { name: "Shell", description: "Use 3 defensive power-ups", emoji: "🐢", pointsValue: 75, condition: "game_defensive_powerups >= 3", achievementType: "survival", category: "Game" },
          { name: "Bunker", description: "Use 10 defensive power-ups", emoji: "🏰", pointsValue: 250, condition: "game_defensive_powerups >= 10", achievementType: "survival", category: "Game" },
          { name: "Fortress", description: "Use 25 defensive power-ups", emoji: "🗼", pointsValue: 500, condition: "game_defensive_powerups >= 25", achievementType: "survival", category: "Game" },
          { name: "The Comeback Kid", description: "Get eliminated, revive and get an elimination in one round", emoji: "🔁", pointsValue: 250, condition: "round_revive_then_eliminate", achievementType: "survival", category: "Round" },
          { name: "Apparition", description: "Vanish from map 5x in one game", emoji: "👻", pointsValue: 75, condition: "game_vanish_count >= 5", achievementType: "survival", category: "Game" },
          { name: "Ghost Story", description: "Vanish from map 10x in one game", emoji: "🌫️", pointsValue: 150, condition: "game_vanish_count >= 10", achievementType: "survival", category: "Game" },
          { name: "Urban Legend", description: "Vanish 25x in one game", emoji: "🕸️", pointsValue: 300, condition: "game_vanish_count >= 25", achievementType: "survival", category: "Game" },
          { name: "On the Run", description: "Survive one bounty", emoji: "🏃", pointsValue: 100, condition: "game_bounties_survived >= 1", achievementType: "survival", category: "Game" },
          { name: "Public Enemy", description: "Survive 3 bounties", emoji: "🚨", pointsValue: 300, condition: "game_bounties_survived >= 3", achievementType: "survival", category: "Game" },
          { name: "Most Wanted", description: "Survive 5 bounties", emoji: "🎪", pointsValue: 500, condition: "game_bounties_survived >= 5", achievementType: "survival", category: "Game" },
          { name: "Bulletproof", description: "Survive 3 open seasons or purges", emoji: "🔒", pointsValue: 175, condition: "purges_survived >= 3", achievementType: "survival", category: "Game" },
          { name: "Above the Law", description: "Survive 5 open seasons or purges", emoji: "⚖️", pointsValue: 400, condition: "purges_survived >= 5", achievementType: "survival", category: "Game" },
          { name: "Not Today Satan", description: "Survive 8 open seasons or purges", emoji: "😇", pointsValue: 750, condition: "purges_survived >= 8", achievementType: "survival", category: "Game" },
          // === CHAOS ACHIEVEMENTS ===
          { name: "Shopaholic", description: "Purchase 5 power-ups", emoji: "🛍️", pointsValue: 100, condition: "game_powerups_purchased >= 5", achievementType: "chaos", category: "Game" },
          { name: "Big Spender", description: "Purchase 10 power-ups", emoji: "💸", pointsValue: 250, condition: "game_powerups_purchased >= 10", achievementType: "chaos", category: "Game" },
          { name: "Hoarder", description: "Purchase 15+ power-ups", emoji: "📦", pointsValue: 500, condition: "game_powerups_purchased >= 15", achievementType: "chaos", category: "Game" },
          { name: "Risk Taker", description: "Spin roulette wheel 1x", emoji: "🎲", pointsValue: 75, condition: "game_roulette_spins >= 1", achievementType: "chaos", category: "Game" },
          { name: "High Roller", description: "Spin roulette wheel 5x", emoji: "🎰", pointsValue: 150, condition: "game_roulette_spins >= 5", achievementType: "chaos", category: "Game" },
          { name: "Gambling Addict", description: "Spin roulette wheel 10x", emoji: "🃏", pointsValue: 450, condition: "game_roulette_spins >= 10", achievementType: "chaos", category: "Game" },
          { name: "Instigator", description: "Use 2 chaos power-ups", emoji: "😏", pointsValue: 200, condition: "game_chaos_powerups >= 2", achievementType: "chaos", category: "Game" },
          { name: "Loose Cannon", description: "Use 5 chaos power-ups", emoji: "💣", pointsValue: 450, condition: "game_chaos_powerups >= 5", achievementType: "chaos", category: "Game" },
          { name: "Anarchist", description: "Use 10 chaos power-ups", emoji: "🔥", pointsValue: 650, condition: "game_chaos_powerups >= 10", achievementType: "chaos", category: "Game" },
          { name: "Good Samaritan", description: "Gift 1 power-up", emoji: "🎁", pointsValue: 125, condition: "game_powerups_gifted >= 1", achievementType: "chaos", category: "Game" },
          { name: "Donor", description: "Gift 5 power-ups", emoji: "🤝", pointsValue: 375, condition: "game_powerups_gifted >= 5", achievementType: "chaos", category: "Game" },
          { name: "Sugar Mama", description: "Gift 10 power-ups", emoji: "🍬", pointsValue: 750, condition: "game_powerups_gifted >= 10", achievementType: "chaos", category: "Game" },
        ];

        let created = 0;
        for (const a of achievements) {
          await db.createAchievement({ gameId: input.gameId, ...a });
          created++;
        }
        return { created };
      }),
  }),

  rules: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getGameRules(input.gameId);
      }),

    create: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        ruleText: z.string(),
        isStandard: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createRule(input);
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), isEnabled: z.boolean().optional(), ruleText: z.string().optional() }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateRule(id, data);
        return { success: true };
      }),
  }),

  mapPowerUp: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const viewer = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!viewer) return [];
        await db.expirePlayerPowerUps(input.gameId);
        const smokeScreens = await db.getActiveGamePowerUpsByName(input.gameId, "Smoke Screen");
        if (smokeScreens.length && !smokeScreens.some(smoke => smoke.gamePlayerId === viewer.id)) return [];
        return db.getMapPowerUps(input.gameId);
      }),

    create: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        powerUpId: z.number(),
        latitude: z.string(),
        longitude: z.string(),
        isVisible: z.boolean().default(true),
        clue: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createMapPowerUp(input);
        return { id };
      }),

    claim: protectedProcedure
      .input(z.object({ mapPowerUpId: z.number(), gameId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        await db.claimMapPowerUp(input.mapPowerUpId, player.id);
        return { success: true };
      }),

    // Check proximity to all hidden power-ups and return warmer/colder status
    checkProximity: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        latitude: z.number(),
        longitude: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        const mapPowerUps = await db.getMapPowerUps(input.gameId);
        // Only return proximity for unclaimed, hidden power-ups
        const hidden = mapPowerUps.filter(mp => !mp.isVisible && !mp.claimedBy);

        function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
          const R = 6371000; // Earth radius in meters
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        function getTemperature(meters: number): { label: string; color: string; emoji: string } {
          if (meters <= 30) return { label: "ON FIRE! 🔥", color: "#FF3300", emoji: "🔥" };
          if (meters <= 75) return { label: "BURNING HOT", color: "#FF6600", emoji: "♨️" };
          if (meters <= 137) return { label: "HOT", color: "#FF9900", emoji: "🌡️" };
          if (meters <= 250) return { label: "WARM", color: "#FFCC00", emoji: "☀️" };
          if (meters <= 500) return { label: "LUKEWARM", color: "#FFFF00", emoji: "🌤️" };
          if (meters <= 1000) return { label: "COOL", color: "#88CCFF", emoji: "💨" };
          if (meters <= 2000) return { label: "COLD", color: "#4499FF", emoji: "❄️" };
          return { label: "FREEZING", color: "#0044FF", emoji: "🧊" };
        }

        return hidden.map(mp => {
          const dist = haversineMeters(
            input.latitude, input.longitude,
            parseFloat(mp.latitude), parseFloat(mp.longitude)
          );
          const temp = getTemperature(dist);
          return {
            id: mp.id,
            clue: mp.clue,
            distanceMeters: Math.round(dist),
            distanceYards: Math.round(dist * 1.09361),
            temperature: temp,
            isWithin150Yards: dist <= 137, // 150 yards = ~137 meters
          };
        });
      }),

    // Player submits a location guess for a hidden power-up
    submitGuess: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        mapPowerUpId: z.number(),
        guessLatitude: z.number(),
        guessLongitude: z.number(),
        guessAddress: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        const mapPowerUps = await db.getMapPowerUps(input.gameId);
        const target = mapPowerUps.find(mp => mp.id === input.mapPowerUpId);
        if (!target) throw new Error("Power-up not found");
        if (target.claimedBy) throw new Error("This power-up has already been claimed");

        function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
          const R = 6371000;
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }

        const dist = haversineMeters(
          input.guessLatitude, input.guessLongitude,
          parseFloat(target.latitude), parseFloat(target.longitude)
        );

        // Record the guess in the DB
        await db.createMapPowerUpGuess({
          mapPowerUpId: input.mapPowerUpId,
          gamePlayerId: player.id,
          guessLatitude: input.guessLatitude.toString(),
          guessLongitude: input.guessLongitude.toString(),
          distanceMeters: Math.round(dist),
          isCorrect: dist <= 100, // Within 100 meters = correct
        });

        if (dist <= 100) {
          // Correct guess — reveal the actual address/directions
          return {
            correct: true,
            distanceMeters: Math.round(dist),
            message: "✅ Correct! Head to the exact location.",
            revealedLatitude: target.latitude,
            revealedLongitude: target.longitude,
          };
        } else {
          const yards = Math.round(dist * 1.09361);
          let hint = "";
          if (dist <= 500) hint = "You're close! Try again.";
          else if (dist <= 1000) hint = "Getting warmer. Refine your guess.";
          else hint = "Way off. Re-read the clue.";
          return {
            correct: false,
            distanceMeters: Math.round(dist),
            distanceYards: yards,
            message: `❌ Wrong — you were ${yards} yards off. ${hint}`,
          };
        }
      }),
  }),

  roulette: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return db.getRouletteOutcomes(input.gameId);
      }),

    create: protectedProcedure
      .input(z.object({
        gameId: z.number(),
        name: z.string(),
        emoji: z.string(),
        type: z.enum(["power_up", "points_bonus", "points_penalty", "discount_coupon", "nothing", "custom"]),
        value: z.number().default(0),
        powerUpId: z.number().nullable().optional(),
        weight: z.number().default(1),
        description: z.string().optional(),
        isEnabled: z.boolean().default(true),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createRouletteOutcome(input);
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        emoji: z.string().optional(),
        type: z.enum(["power_up", "points_bonus", "points_penalty", "discount_coupon", "nothing", "custom"]).optional(),
        value: z.number().optional(),
        powerUpId: z.number().nullable().optional(),
        weight: z.number().optional(),
        description: z.string().optional(),
        isEnabled: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateRouletteOutcome(id, data);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteRouletteOutcome(input.id);
        return { success: true };
      }),

    spin: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        const roulettePowerUp = (await db.getGamePowerUps(input.gameId))
          .find(powerUp => powerUp.name === "Roulette" && powerUp.isEnabled);
        if (!roulettePowerUp) throw new Error("Roulette power-up is not available");
        const rouletteCost = roulettePowerUp.discount
          ? Math.floor(roulettePowerUp.cost * (1 - roulettePowerUp.discount / 100))
          : roulettePowerUp.cost;
        if ((player.points || 0) < rouletteCost) throw new Error("Not enough points");
        await db.updatePlayer(player.id, { points: (player.points || 0) - rouletteCost });
        const outcomes = await db.getRouletteOutcomes(input.gameId);
        const enabled = outcomes.filter(o => o.isEnabled);
        if (enabled.length === 0) throw new Error("No roulette outcomes configured");
        // Weighted random selection
        const totalWeight = enabled.reduce((sum, o) => sum + o.weight, 0);
        let rand = Math.random() * totalWeight;
        let selected = enabled[0];
        for (const outcome of enabled) {
          rand -= outcome.weight;
          if (rand <= 0) { selected = outcome; break; }
        }
        // Apply the outcome
        let resultMessage = "";
        switch (selected.type) {
          case "points_bonus":
            await db.updatePlayer(player.id, { points: (player.points || 0) + (selected.value || 0) });
            resultMessage = `Won ${selected.value} points!`;
            break;
          case "points_penalty":
            await db.updatePlayer(player.id, { points: Math.max(0, (player.points || 0) - (selected.value || 0)) });
            resultMessage = `Lost ${selected.value} points!`;
            break;
          case "power_up":
            if (selected.powerUpId) {
              await db.purchasePowerUp(player.id, selected.powerUpId, input.gameId);
              resultMessage = `Won a free power-up! It has been added to your inventory.`;
            } else {
              resultMessage = selected.description || "Mystery prize!";
            }
            break;
          case "discount_coupon":
            await db.updatePlayer(player.id, { pendingDiscountPercent: selected.value });
            resultMessage = `Got a ${selected.value}% discount coupon!`;
            break;
          case "nothing":
            resultMessage = "Better luck next time!";
            break;
          case "custom":
            resultMessage = selected.description || "Something happened!";
            break;
        }
        return { outcome: selected, message: resultMessage };
      }),

    seedDefaults: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input }) => {
        const defaults = [
          { name: "Jackpot", emoji: "\ud83c\udf89", type: "points_bonus" as const, value: 500, weight: 1, description: "Hit the jackpot! +500 points" },
          { name: "Big Win", emoji: "\ud83d\udcb0", type: "points_bonus" as const, value: 200, weight: 2, description: "+200 points" },
          { name: "Small Win", emoji: "\ud83d\udcb5", type: "points_bonus" as const, value: 50, weight: 4, description: "+50 points" },
          { name: "Free Power-Up", emoji: "\u26a1", type: "power_up" as const, value: 0, weight: 2, description: "Win a random power-up from the shop" },
          { name: "Half Off", emoji: "\ud83c\udff7\ufe0f", type: "discount_coupon" as const, value: 50, weight: 3, description: "50% off your next power-up purchase" },
          { name: "Quarter Off", emoji: "\ud83c\udff7\ufe0f", type: "discount_coupon" as const, value: 25, weight: 4, description: "25% off your next power-up purchase" },
          { name: "Small Loss", emoji: "\ud83d\ude2c", type: "points_penalty" as const, value: 25, weight: 4, description: "Ouch! -25 points" },
          { name: "Big Loss", emoji: "\ud83d\udca9", type: "points_penalty" as const, value: 100, weight: 2, description: "That hurts! -100 points" },
          { name: "Nothing", emoji: "\ud83e\udee5", type: "nothing" as const, value: 0, weight: 5, description: "The wheel gives nothing. Try again?" },
          { name: "Double Trouble", emoji: "\ud83c\udfb2", type: "custom" as const, value: 0, weight: 1, description: "Your next elimination is worth double OR you lose double if eliminated first" },
          { name: "Exposed!", emoji: "\ud83d\udea8", type: "custom" as const, value: 0, weight: 2, description: "Your location is revealed to all players for 15 minutes" },
          { name: "Mystery Box", emoji: "\ud83c\udf81", type: "custom" as const, value: 0, weight: 2, description: "Admin decides your fate..." },
        ];
        const ids: number[] = [];
        for (const d of defaults) {
          const id = await db.createRouletteOutcome({ ...d, gameId: input.gameId, isEnabled: true });
          ids.push(id);
        }
        return { count: ids.length, ids };
      }),
  }),
});

export type AppRouter = typeof appRouter;
