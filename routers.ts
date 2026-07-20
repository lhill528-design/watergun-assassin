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
      .query(async ({ input }) => {
        return db.getGamePlayers(input.gameId);
      }),

    me: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        return db.getPlayerInGame(input.gameId, ctx.user.id);
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
          await db.createNotification({ userId: game.adminId, gameId: input.gameId, type: "location_disabled", title: "⚠️ Location Disabled", body: `Player ${ctx.user.name || ctx.user.id} has disabled their location.` });
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
        duration: z.number().nullable().optional(),
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
        const defaultPowerUps: Array<{name:string;emoji:string;effect:string;cost:number;duration:number|null;category:"offensive"|"defensive"|"utility"|"special"|"chaos";description:string}> = [
          // === OFFENSIVE (19) ===
          { name: "Bounty", emoji: "💰", effect: "Place bounty on any player (Hunter receives 300pts)", cost: 150, duration: 360, category: "offensive", description: "Place bounty on any player. The hunter who eliminates that player receives 300pts. Bounty lasts 6hrs. Your name is NOT revealed as the bounty placer." },
          { name: "Raise the Stakes", emoji: "📈", effect: "Double the existing bounty on any player (hunter receives 600pts)", cost: 200, duration: 180, category: "offensive", description: "Double the existing bounty on any player. The hunter who eliminates them receives 600pts instead of 300. Lasts 3hrs. If no bounty exists, this places a standard bounty instead." },
          { name: "Killswitch", emoji: "💀", effect: "Strip all of the target's active power-ups (destroys ALL)", cost: 300, duration: null, category: "offensive", description: "Immediately deactivates ALL active power-ups on your current target. Shield? Gone. Ghost Mode? Disabled. Immunity Lock? Stripped. They receive a notification that their power-ups were stripped but NOT who did it." },
          { name: "Radar", emoji: "📡", effect: "Reveal all active players' locations on the map", cost: 200, duration: 120, category: "offensive", description: "For 2 hours, your map shows the real-time location of EVERY alive player, not just your target. Essentially a personal mini-purge without revealing your own location." },
          { name: "Recon", emoji: "🔍", effect: "See target's purchased power-ups and current point balance", cost: 100, duration: 120, category: "offensive", description: "Reveals your target's current point balance and all their active/purchased power-ups with remaining durations. Know if they have a Shield before you make your move. Lasts 2hrs." },
          { name: "Asset Freeze", emoji: "🧊", effect: "Block a target from buying power-ups", cost: 175, duration: 240, category: "offensive", description: "For 4 hours, your target cannot purchase any power-ups from the shop. They can still use power-ups they already own. They see a 'FROZEN' indicator on their shop screen." },
          { name: "Sabotage", emoji: "🔧", effect: "Target's next power-up purchase costs double", cost: 100, duration: 360, category: "offensive", description: "The next power-up your target purchases within 6 hours costs them double the listed price. They are NOT notified of the sabotage until they make the purchase and see the inflated cost." },
          { name: "Sniper's Duel", emoji: "🎯", effect: "Challenge any active player to a duel. Winner gets 100pts & can steal one power-up", cost: 200, duration: null, category: "offensive", description: "Challenge any active player to a duel. Both players are notified. First to eliminate the other wins 100pts and can steal one of the loser's power-ups. Can only be used once per round." },
          { name: "Jackpot", emoji: "✨", effect: "Next kill earns double points (1x per game)", cost: 250, duration: 1440, category: "offensive", description: "Your next confirmed elimination earns double the normal elimination points. Stacks with bounty points. One-time use per game, lasts up to 24hrs until triggered." },
          { name: "Bounty Hunter", emoji: "🎯", effect: "Bonus points for next bounty you collect (Earns 450pts for 1 kill)", cost: 175, duration: 1440, category: "offensive", description: "The next time you eliminate a player who has a bounty on them, you receive 450pts instead of the normal 300. One-time use, lasts up to 24hrs." },
          { name: "Vampire", emoji: "🧛", effect: "Gain 1 extra life for every kill in the time period (Max 3 lives / 1x per game)", cost: 400, duration: 120, category: "offensive", description: "For 2 hours, each confirmed elimination grants you an automatic Revive token (max 3). As long as you keep killing, you can't stay dead. One-time use per game." },
          { name: "Smoke Screen", emoji: "💨", effect: "Hide all map power-up pickups from every active player", cost: 150, duration: 120, category: "offensive", description: "For 2 hours, ALL hidden map power-ups become invisible to every player except you. You can collect them freely while others can't even see they exist." },
          { name: "Vendetta", emoji: "⚔️", effect: "Go after a previously missed target from prior round", cost: 200, duration: 120, category: "offensive", description: "For 2 hours, you can eliminate any player who previously eliminated you OR any previous target you failed to get. You receive their location for the duration." },
          { name: "Blackout", emoji: "⚫", effect: "Remove all player locations from the map for certain time period", cost: 300, duration: 120, category: "offensive", description: "For 2 hours, NO player locations are visible on anyone's map. Even during purge, the map goes dark. Everyone is notified when Blackout starts and ends." },
          { name: "Fall Guy", emoji: "🪖", effect: "Force someone to be your bodyguard, if you're shot, they're eliminated (1x per game)", cost: 250, duration: 240, category: "offensive", description: "Force any alive player to be your human shield for 4 hours. If someone eliminates you during this time, the conscripted player is eliminated INSTEAD. They are notified. 1x per game." },
          { name: "Hitman's Cut", emoji: "💎", effect: "Get half the points from any kills achieved while active", cost: 250, duration: 240, category: "offensive", description: "For 4 hours, whenever ANY player eliminates someone, you receive 50% of their earned points (bonus points generated, not taken from them). Passive income." },
          { name: "Frame Job", emoji: "🖼️", effect: "Transfer your bounty to someone else, if they're eliminated your bounty is fulfilled", cost: 150, duration: 240, category: "offensive", description: "Transfer all bounties currently on you to another player. If that player is eliminated, the bounties are considered fulfilled. If they survive, bounties transfer back after 4hrs." },
          { name: "Strip Search", emoji: "🔓", effect: "Remove another player's immunity shield for 2hrs", cost: 200, duration: 120, category: "offensive", description: "Immediately removes another player's active Immunity Shield or Shield power-up for 2 hours. They are notified their shield was stripped but not by whom." },
          { name: "Boomerang", emoji: "🪃", effect: "If your hunter shoots you while active, it will boomerang back & eliminate them", cost: 300, duration: 180, category: "offensive", description: "For 3 hours, if the player hunting you attempts to eliminate you, the elimination boomerangs back and eliminates THEM instead. They are not warned. Ultimate counter-play." },
          // === DEFENSIVE (15) ===
          { name: "Immunity Shield", emoji: "🛡️", effect: "Immunity from elimination while active", cost: 250, duration: 240, category: "defensive", description: "Activates a protective barrier. While active, any elimination attempt against you automatically fails. The attacker is NOT notified. Lasts 4 hours." },
          { name: "Dead Zone", emoji: "👻", effect: "Hide location from the map while active", cost: 150, duration: 120, category: "defensive", description: "Your location completely disappears from all maps for 2 hours. Other players see your last known location frozen in place. Great for ambushes or escaping hunters." },
          { name: "Clean Slate", emoji: "🧹", effect: "Remove a bounty placed on you", cost: 100, duration: null, category: "defensive", description: "Instantly removes ALL active bounties placed on you. The bounty points vanish. Use when your bounty is climbing and you want to reduce incentive for others to target you." },
          { name: "Radar Detector", emoji: "📟", effect: "Get notified when someone checks your location on the map", cost: 125, duration: 240, category: "defensive", description: "For 4 hours, you receive a push notification any time another player views your location on the map. You'll know their name and the exact time." },
          { name: "Revive", emoji: "❤️", effect: "Come back to life after elimination. Must be used in round eliminated. (1x per game)", cost: 500, duration: null, category: "defensive", description: "The ultimate second chance. If eliminated while holding this, you automatically come back to life. Must be purchased BEFORE elimination. One-time use per game. You keep your points." },
          { name: "Untouchable", emoji: "🔒", effect: "24hr Immunity (Only 1x per game)", cost: 450, duration: 1440, category: "defensive", description: "Grants 24-hour complete immunity that CANNOT be removed by purge events or Strip Search. The most powerful defensive power-up. Cannot stack with Immunity Shield. 1x per game." },
          { name: "Lucky Charm", emoji: "🍀", effect: "Auto-survive your next elimination without a re-entry fee", cost: 350, duration: null, category: "defensive", description: "Works like a passive shield — when triggered, your attacker's elimination attempt simply fails. Unlike Revive, you were never eliminated. One-time use, no expiration." },
          { name: "Decoy", emoji: "🎭", effect: "Drop a fake location marker that others think is you", cost: 125, duration: 120, category: "defensive", description: "Places a fake GPS marker at a location you choose. For 2 hours, anyone tracking you sees the decoy location instead of your real one. Set it and move." },
          { name: "Identity Theft", emoji: "📌", effect: "Swap map location with any active player", cost: 175, duration: 120, category: "defensive", description: "For 2 hours, your GPS marker shows at another player's location and theirs shows at yours. Both players are notified. Creates confusion for trackers." },
          { name: "Mirror, Mirror", emoji: "🪞", effect: "Steal power of someone else's active power-up and get effects applied to you", cost: 250, duration: 120, category: "defensive", description: "Copy the effects of another player's active power-up onto yourself for 2 hours. The original player keeps their power-up. You get the same benefits." },
          { name: "Bodyguard", emoji: "💪", effect: "Give another player protection. If they get shot you lose 150pts. (1x per game)", cost: 200, duration: 180, category: "defensive", description: "Assign protection to any player for 3 hours. While protected, elimination attempts against them fail. If they ARE eliminated, you lose 150pts. 1x per game, not usable during purge." },
          { name: "Respawn", emoji: "🔄", effect: "Undo your elimination, must pay half revival fee. Within 1hr of approval", cost: 300, duration: null, category: "defensive", description: "If eliminated, activate within 1 hour of elimination approval to undo it. You must pay half the revival fee. You return to alive status and the elimination is erased." },
          { name: "Witness Protection", emoji: "🕶️", effect: "Temporary safety from elimination and location removed from map", cost: 225, duration: 120, category: "defensive", description: "For 2 hours, you cannot be eliminated AND your location is removed from the map. Complete safety and invisibility combined. Cannot attack during this time." },
          { name: "Sanctuary", emoji: "⛪", effect: "Safe location for 2hrs. Can be eliminated but they may not enter location. (1x per game)", cost: 200, duration: 120, category: "defensive", description: "Designate your current location as a sanctuary zone (50m radius) for 2 hours. Players may not enter to eliminate you. If you leave, protection ends. 1x per game." },
          { name: "Burner Phone", emoji: "📱", effect: "Location power-ups used against will not work (Trace, Radar, Smoke Screen)", cost: 175, duration: 120, category: "defensive", description: "For 2 hours, any location-revealing power-ups used against you (Radar, Trace, Smoke Screen) return false information. Your real location stays hidden from power-up tracking." },
          // === CHAOS (9) ===
          { name: "Safe Swap", emoji: "🔀", effect: "Swap safe object for all players", cost: 300, duration: 1440, category: "chaos", description: "When activated, the safe object changes for ALL players in the game for 24 hours. Admin-determined new safe object. Creates chaos as everyone scrambles to find the new object." },
          { name: "Reassignment", emoji: "🔄", effect: "Swap for a random new target", cost: 150, duration: null, category: "chaos", description: "Instantly reassigns you a new random target from the pool of alive players. Your old target gets reassigned to someone else. Use when your current target is too difficult." },
          { name: "Pickpocket", emoji: "🪙", effect: "Drain half the current points from a target & add to your score (Max 400)", cost: 200, duration: null, category: "chaos", description: "Steals half the points from your current target (max 400pts) and adds them to your balance. They receive a notification they were robbed but not by whom." },
          { name: "Freaky Friday", emoji: "🎭", effect: "Swap ALL players' targets at once for remainder of the round", cost: 500, duration: null, category: "chaos", description: "The ultimate chaos power-up. EVERY player in the game gets randomly reassigned a new target simultaneously. Everyone is notified. Creates total confusion and resets all strategies." },
          { name: "Lifeline", emoji: "🚑", effect: "Revive one eliminated player, must be used in same round (2x max per game)", cost: 400, duration: null, category: "chaos", description: "Bring back one eliminated player of your choice from the current round. They return with 50% of their points. Can be used 2x max per game. The revived player owes you nothing." },
          { name: "Care Package", emoji: "🎁", effect: "Gift any power-up you own to any other player", cost: 75, duration: null, category: "chaos", description: "Transfer any unused power-up from your inventory to another player. The recipient is notified who sent it. Useful for alliances or generosity." },
          { name: "Open Season", emoji: "🔫", effect: "Eliminate any player, no safe objects. 50pts for each elimination", cost: 400, duration: 30, category: "chaos", description: "For 30 minutes, you can eliminate ANY alive player regardless of safe objects or target assignment. Earn 50pts per elimination. All players are notified someone activated Open Season." },
          { name: "Roulette", emoji: "🎰", effect: "Spin for random power-ups, discounts and points", cost: 100, duration: null, category: "chaos", description: "Spin the wheel! Possible outcomes set by admin: free power-up, point bonus, point penalty, discount coupon, or nothing. Cheap gamble that could pay off big or cost you." },
          { name: "Wildcard", emoji: "🃏", effect: "Admin assigns a random challenge — complete it for bonus points", cost: 50, duration: null, category: "chaos", description: "The admin assigns you a secret random challenge. Complete it within the time limit for bonus points. Challenges vary: find a specific player, reach a location, or perform a task. Admin sets the reward." },
        ];
        const ids: number[] = [];
        for (const pu of defaultPowerUps) {
          const id = await db.createPowerUp({ ...pu, gameId: input.gameId, isEnabled: true, discount: 0 });
          ids.push(id);
        }
        return { count: ids.length, ids };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        cost: z.number().optional(),
        isEnabled: z.boolean().optional(),
        discount: z.number().optional(),
        duration: z.number().nullable().optional(),
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
        const cost = powerUp.discount ? Math.floor(powerUp.cost * (1 - powerUp.discount / 100)) : powerUp.cost;
        if ((player.points || 0) < cost) throw new Error("Not enough points");
        await db.updatePlayer(player.id, { points: (player.points || 0) - cost });
        const expiresAt = powerUp.duration ? new Date(Date.now() + powerUp.duration * 60000) : null;
        await db.purchasePowerUp(player.id, powerUp.id, input.gameId, expiresAt);
        // If it's a defensive/shield power-up, send chat notification
        if (powerUp.category === "defensive") {
          await db.createChatMessage({ gameId: input.gameId, userId: ctx.user.id, message: `${powerUp.emoji} ${ctx.user.name || "A player"} activated ${powerUp.name}!`, isSystem: true, powerUpIcon: powerUp.emoji });
        }
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: player.id, message: `${powerUp.emoji} ${powerUp.name} activated!` });
        // Auto-detect achievements after purchase
        await db.checkAndAwardAchievements(player.id, input.gameId);
        return { success: true };
      }),

    playerActive: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) return [];
        return db.getPlayerPowerUps(player.id);
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
        const status = input.approved ? "approved" : "denied";
        const game = await db.getGame(input.gameId);
        const eliminationPoints = game?.eliminationPoints || 100;
        await db.updateElimination(input.eliminationId, { status, reviewedBy: ctx.user.id, reviewedAt: new Date(), pointsAwarded: input.approved ? eliminationPoints : 0 });
        
        if (input.approved) {
          const elim = await db.getElimination(input.eliminationId);
          if (elim) {
            // Award points to eliminator
            const players = await db.getGamePlayers(input.gameId);
            const eliminator = players.find(p => p.id === elim.eliminatorId);
            const eliminated = players.find(p => p.id === elim.eliminatedId);
            if (eliminator) {
              await db.updatePlayer(eliminator.id, { points: (eliminator.points || 0) + eliminationPoints, kills: (eliminator.kills || 0) + 1 });
              // Claim any bounties on the eliminated player
              if (eliminated) {
                const bountyTotal = eliminated.bountyPoints || 0;
                if (bountyTotal > 0) {
                  await db.claimBounties(input.gameId, eliminated.id, eliminator.id);
                  await db.updatePlayer(eliminator.id, { points: (eliminator.points || 0) + eliminationPoints + bountyTotal });
                  await db.createKillFeedEvent({ gameId: input.gameId, eventType: "bounty_claimed", actorId: eliminator.id, targetId: eliminated.id, message: `💰 Bounty of ${bountyTotal} points claimed!` });
                }
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
          await db.createKillFeedEvent({ gameId: input.gameId, eventType: "elimination_approved", message: "💀 Elimination confirmed!" });
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

  chat: router({
    messages: protectedProcedure
      .input(z.object({ gameId: z.number(), limit: z.number().default(50) }))
      .query(async ({ input }) => {
        return db.getGameChat(input.gameId, input.limit);
      }),

    send: protectedProcedure
      .input(z.object({ gameId: z.number(), message: z.string().min(1).max(1000) }))
      .mutation(async ({ ctx, input }) => {
        await db.createChatMessage({ gameId: input.gameId, userId: ctx.user.id, message: input.message });
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
          { name: "First Blood", description: "Get your 1st elimination", emoji: "🩸", pointsValue: 25, condition: "lifetime_eliminations >= 1", category: "combat" },
          { name: "Public Menace", description: "Get 15 eliminations", emoji: "😈", pointsValue: 50, condition: "lifetime_eliminations >= 15", category: "combat" },
          { name: "Living Legend", description: "Get 25 eliminations", emoji: "🏆", pointsValue: 100, condition: "lifetime_eliminations >= 25", category: "combat" },
          { name: "Elimination God", description: "Get 50 eliminations", emoji: "💀", pointsValue: 150, condition: "lifetime_eliminations >= 50", category: "combat" },
          { name: "Wet Bandit", description: "Get 1st elimination of the game", emoji: "🔫", pointsValue: 25, condition: "game_first_elimination", category: "combat" },
          { name: "Predator", description: "Get 5 eliminations in one game", emoji: "🦅", pointsValue: 50, condition: "game_eliminations >= 5", category: "combat" },
          { name: "Apex Predator", description: "Get 10 kills in one game", emoji: "🦁", pointsValue: 100, condition: "game_eliminations >= 10", category: "combat" },
          { name: "Sharpsquirter", description: "Get the 1st elimination of the round", emoji: "💧", pointsValue: 25, condition: "round_first_elimination", category: "combat" },
          { name: "Serial Soaker", description: "Get 3 eliminations in one round", emoji: "🌊", pointsValue: 50, condition: "round_eliminations >= 3", category: "combat" },
          { name: "Drip Queen", description: "Get 5 eliminations in one round", emoji: "👑", pointsValue: 100, condition: "round_eliminations >= 5", category: "combat" },
          { name: "Cat Burglar", description: "Use 1 theft power-up in one game", emoji: "🐱", pointsValue: 25, condition: "game_theft_powerups >= 1", category: "combat" },
          { name: "Master Thief", description: "Use 3 theft power-ups in one game", emoji: "🥷", pointsValue: 50, condition: "game_theft_powerups >= 3", category: "combat" },
          { name: "Crime Boss", description: "Use 10+ power-ups in one game", emoji: "🤵", pointsValue: 100, condition: "game_powerups_used >= 10", category: "combat" },
          { name: "Hit List", description: "Place a bounty on active player in one game", emoji: "📋", pointsValue: 25, condition: "game_bounties_placed >= 1", category: "combat" },
          { name: "Bounty Broker", description: "Place 5 bounties on active player in one game", emoji: "💰", pointsValue: 50, condition: "game_bounties_placed >= 5", category: "combat" },
          { name: "Crime Syndicate", description: "Place 15+ bounties on active player in one game", emoji: "🏦", pointsValue: 100, condition: "game_bounties_placed >= 15", category: "combat" },
          { name: "Tracker", description: "Collect 1 bounty in one game", emoji: "🎯", pointsValue: 25, condition: "game_bounties_collected >= 1", category: "combat" },
          { name: "Bounty Hunter", description: "Collect 5 bounties in one game", emoji: "🏹", pointsValue: 50, condition: "game_bounties_collected >= 5", category: "combat" },
          { name: "Legend Hunter", description: "Collect 10+ bounties in one game", emoji: "⚔️", pointsValue: 100, condition: "game_bounties_collected >= 10", category: "combat" },
          { name: "Killing Spree", description: "Get 3 eliminations without dying in one game", emoji: "🔥", pointsValue: 25, condition: "game_kill_streak >= 3", category: "combat" },
          { name: "Rampage", description: "Get 5 eliminations without dying in one game", emoji: "💥", pointsValue: 50, condition: "game_kill_streak >= 5", category: "combat" },
          { name: "One Man Army", description: "Get 10+ eliminations in one game without dying", emoji: "🪖", pointsValue: 100, condition: "game_kill_streak >= 10", category: "combat" },
          { name: "No Mercy", description: "Eliminate 3 players during open season or a purge", emoji: "😤", pointsValue: 25, condition: "purge_eliminations >= 3", category: "combat" },
          { name: "Grudge Match", description: "Eliminate 5 players during open season or a purge", emoji: "😡", pointsValue: 50, condition: "purge_eliminations >= 5", category: "combat" },
          { name: "Uno Reverse", description: "Eliminate any of your previous or current hunters during a purge", emoji: "🔄", pointsValue: 100, condition: "purge_hunter_elimination", category: "combat" },
          // === SURVIVAL ACHIEVEMENTS ===
          { name: "Dry as a Bone", description: "Survive 3 consecutive rounds", emoji: "🦴", pointsValue: 50, condition: "consecutive_rounds_survived >= 3", category: "survival" },
          { name: "Untouchable", description: "Survive 5 consecutive rounds", emoji: "🛡️", pointsValue: 100, condition: "consecutive_rounds_survived >= 5", category: "survival" },
          { name: "Shell", description: "Use 3 defensive power-ups", emoji: "🐢", pointsValue: 25, condition: "game_defensive_powerups >= 3", category: "survival" },
          { name: "Bunker", description: "Use 10 defensive power-ups", emoji: "🏰", pointsValue: 50, condition: "game_defensive_powerups >= 10", category: "survival" },
          { name: "Fortress", description: "Use 25 defensive power-ups", emoji: "🗼", pointsValue: 100, condition: "game_defensive_powerups >= 25", category: "survival" },
          { name: "The Comeback Kid", description: "Get eliminated, revive and get an elimination in one round", emoji: "🔁", pointsValue: 150, condition: "round_revive_then_eliminate", category: "survival" },
          { name: "Apparition", description: "Vanish from map 5x in one game", emoji: "👻", pointsValue: 25, condition: "game_vanish_count >= 5", category: "survival" },
          { name: "Ghost Story", description: "Vanish from map 10x in one game", emoji: "🌫️", pointsValue: 50, condition: "game_vanish_count >= 10", category: "survival" },
          { name: "Urban Legend", description: "Vanish 25x in one game", emoji: "🕸️", pointsValue: 100, condition: "game_vanish_count >= 25", category: "survival" },
          { name: "On the Run", description: "Survive one bounty", emoji: "🏃", pointsValue: 25, condition: "game_bounties_survived >= 1", category: "survival" },
          { name: "Public Enemy", description: "Survive 3 bounties", emoji: "🚨", pointsValue: 50, condition: "game_bounties_survived >= 3", category: "survival" },
          { name: "Most Wanted", description: "Survive 5 bounties", emoji: "🎪", pointsValue: 100, condition: "game_bounties_survived >= 5", category: "survival" },
          { name: "Bulletproof", description: "Survive 3 open seasons or purges", emoji: "🔒", pointsValue: 25, condition: "purges_survived >= 3", category: "survival" },
          { name: "Above the Law", description: "Survive 5 open seasons or purges", emoji: "⚖️", pointsValue: 50, condition: "purges_survived >= 5", category: "survival" },
          { name: "Not Today Satan", description: "Survive 8 open seasons or purges", emoji: "😇", pointsValue: 100, condition: "purges_survived >= 8", category: "survival" },
          // === CHAOS ACHIEVEMENTS ===
          { name: "Shopaholic", description: "Purchase 5 power-ups", emoji: "🛍️", pointsValue: 25, condition: "game_powerups_purchased >= 5", category: "chaos" },
          { name: "Big Spender", description: "Purchase 10 power-ups", emoji: "💸", pointsValue: 50, condition: "game_powerups_purchased >= 10", category: "chaos" },
          { name: "Hoarder", description: "Purchase 15+ power-ups", emoji: "📦", pointsValue: 100, condition: "game_powerups_purchased >= 15", category: "chaos" },
          { name: "Risk Taker", description: "Spin roulette wheel 1x", emoji: "🎲", pointsValue: 25, condition: "game_roulette_spins >= 1", category: "chaos" },
          { name: "High Roller", description: "Spin roulette wheel 5x", emoji: "🎰", pointsValue: 50, condition: "game_roulette_spins >= 5", category: "chaos" },
          { name: "Gambling Addict", description: "Spin roulette wheel 10x", emoji: "🃏", pointsValue: 100, condition: "game_roulette_spins >= 10", category: "chaos" },
          { name: "Instigator", description: "Use 2 chaos power-ups", emoji: "😏", pointsValue: 25, condition: "game_chaos_powerups >= 2", category: "chaos" },
          { name: "Loose Cannon", description: "Use 5 chaos power-ups", emoji: "💣", pointsValue: 50, condition: "game_chaos_powerups >= 5", category: "chaos" },
          { name: "Anarchist", description: "Use 10 chaos power-ups", emoji: "🔥", pointsValue: 100, condition: "game_chaos_powerups >= 10", category: "chaos" },
          { name: "Good Samaritan", description: "Gift 1 power-up", emoji: "🎁", pointsValue: 25, condition: "game_powerups_gifted >= 1", category: "chaos" },
          { name: "Donor", description: "Gift 5 power-ups", emoji: "🤝", pointsValue: 50, condition: "game_powerups_gifted >= 5", category: "chaos" },
          { name: "Sugar Mama", description: "Gift 10 power-ups", emoji: "🍬", pointsValue: 100, condition: "game_powerups_gifted >= 10", category: "chaos" },
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
      .query(async ({ input }) => {
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
              const expiresAt = null;
              await db.purchasePowerUp(player.id, selected.powerUpId, input.gameId, expiresAt);
              resultMessage = `Won a free power-up!`;
            } else {
              resultMessage = selected.description || "Mystery prize!";
            }
            break;
          case "discount_coupon":
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
