import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import { getCloudinaryUploadSignature, isValidEliminationVideoUrl } from "./storage";
import { sendPushToUser, sendPushToUsers, registerPushToken } from "./push-service";
import { MAP_CLAIM_METERS, MAP_DISCOVERY_METERS, ROULETTE_SPIN_COST, calculateKillAwards, derangedTargetPermutation, distanceMeters, isOpenSeasonSubmissionEligible, openSeasonWindow, pointFiveMilesAway, rouletteBalanceAfterOutcome } from "./power-up-rules";
import { STANDARD_RULES, type StandardRulesGameType } from "./standard-rules";

// Cloudinary signed uploads have no built-in per-user rate limit, so a
// compromised/malicious client could otherwise mint unlimited signatures
// and spam our storage quota. In-memory sliding window is fine here since
// this runs as a single Railway service instance (not horizontally scaled).
const UPLOAD_SIGNATURE_LIMIT = 8;
const UPLOAD_SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
const uploadSignatureRequests = new Map<number, number[]>();

function checkUploadSignatureRateLimit(userId: number) {
  const now = Date.now();
  const recent = (uploadSignatureRequests.get(userId) ?? []).filter(
    (t) => now - t < UPLOAD_SIGNATURE_WINDOW_MS,
  );
  if (recent.length >= UPLOAD_SIGNATURE_LIMIT) {
    throw new Error("Too many upload attempts. Wait a few minutes and try again.");
  }
  recent.push(now);
  uploadSignatureRequests.set(userId, recent);
}

async function addProtectionBadges<T extends { id: number }>(players: T[]) {
  return Promise.all(players.map(async player => {
    const inventory = await db.getPlayerPowerUps(player.id);
    const isCurrent = (item: (typeof inventory)[number]) => item.status === "active" && (!item.expiresAt || item.expiresAt.getTime() > Date.now());
    const shield = inventory.find(item => item.powerUp?.name === "Immunity Shield" && isCurrent(item) && item.isActive);
    const untouchable = inventory.find(item => item.powerUp?.name === "Untouchable" && isCurrent(item));
    const protectionBadge = shield
      ? { type: "immunity_shield" as const, label: "Shielded", expiresAt: shield.expiresAt, paused: false }
      : untouchable
        ? { type: "untouchable" as const, label: untouchable.isActive ? "Untouchable" : "Paused for Purge", expiresAt: untouchable.expiresAt, paused: !untouchable.isActive }
        : null;
    return { ...player, protectionBadge };
  }));
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    // A verified session whose backend user provisioning failed (DB down,
    // Clerk API failure, etc.) must not look identical to "not signed in"
    // -- see server/_core/context.ts. Surfacing it as a real query error
    // here (instead of quietly returning null) is what lets the client
    // distinguish "signed out" from "signed in, but the backend couldn't
    // finish loading your account" and show a Retry option instead of the
    // sign-in form again.
    me: publicProcedure.query((opts) => {
      if (opts.ctx.authError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't load your account. Please try again.",
        });
      }
      return opts.ctx.user;
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
        const { gameId } = await db.createGameWithAdmin({ ...input, adminId: ctx.user.id });
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
      .mutation(async ({ input, ctx }) => {
        const { gameId, purgeEndTime, roundEndTime, ...rest } = input;
        const game = await db.getGame(gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const updateData: any = { ...rest };
        if (purgeEndTime) updateData.purgeEndTime = new Date(purgeEndTime);
        if (roundEndTime) updateData.roundEndTime = new Date(roundEndTime);
        await db.updateGame(gameId, updateData);
        return { success: true };
      }),

    join: protectedProcedure
      .input(z.object({ gameId: z.number().optional(), joinCode: z.string().optional() }))
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
        const playerId = await db.joinGame({ gameId, userId: ctx.user.id });
        return { playerId, gameId };
      }),

    startPurge: protectedProcedure
      .input(z.object({ gameId: z.number(), durationMinutes: z.number().default(60) }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const endTime = new Date(Date.now() + input.durationMinutes * 60000);
        await db.pausePurgeSensitivePowerUps(input.gameId);
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
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        await db.updateGame(input.gameId, { purgeActive: false, purgeEndTime: null });
        await db.resumePurgeSensitivePowerUps(input.gameId);
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

    schedulePurge: protectedProcedure
      .input(z.object({ gameId: z.number(), startsAt: z.string().nullable() }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const startsAt = input.startsAt ? new Date(input.startsAt) : null;
        if (startsAt && (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now())) throw new Error("Choose a future purge time");
        await db.updateGame(input.gameId, { purgeScheduledAt: startsAt });
        return { success: true };
      }),

    startRound: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game) throw new Error("Game not found");
        if (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin) throw new Error("Admin access required");
        const newRound = (game.currentRound || 0) + 1;
        const roundEnd = new Date(Date.now() + (game.roundLength || 72) * 3600000);
        const roundPlayers = await db.getGamePlayers(input.gameId);
        for (const player of roundPlayers) {
          if (player.nextRoundTargetId) await db.updatePlayer(player.id, { targetId: player.nextRoundTargetId, nextRoundTargetId: null });
        }
        const wildcards = await db.getActiveGamePowerUpsByName(input.gameId, "Wildcard");
        for (const wildcard of wildcards) {
          const owner = roundPlayers.find(player => player.id === wildcard.gamePlayerId);
          const selected = roundPlayers.find(player => player.id === wildcard.targetPlayerId);
          const selectedHunter = selected ? roundPlayers.find(player => player.id !== owner?.id && player.targetId === selected.id && player.status === "alive") : undefined;
          if (!owner || owner.status !== "alive" || !selected || selected.status !== "alive" || !selectedHunter || !owner.targetId || owner.targetId === selectedHunter.id) {
            await db.returnPowerUpToInventory(wildcard.id);
            if (owner) await db.createNotification({ userId: owner.userId, gameId: input.gameId, type: "power_up_used", title: "Wildcard Returned", body: "Your selected target was no longer valid at round start. Choose again for a later round." });
            continue;
          }
          const oldTarget = owner.targetId;
          await db.updatePlayer(owner.id, { targetId: selected.id });
          await db.updatePlayer(selectedHunter.id, { targetId: oldTarget });
          await db.consumePlayerPowerUp(wildcard.id);
        }
        await db.updateGame(input.gameId, { currentRound: newRound, roundEndTime: roundEnd, status: "active" });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "round_start", message: `🎯 Round ${newRound} has begun!` });
        return { success: true };
      }),

    endRound: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        for (const vendetta of await db.getActiveGamePowerUpsByName(input.gameId, "Vendetta")) await db.consumePlayerPowerUp(vendetta.id);
        await db.updateGame(input.gameId, { roundEndTime: null });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "round_end", message: `🏁 Round ${game?.currentRound || 0} has ended!` });
        return { success: true };
      }),

    endGame: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        await db.updateGame(input.gameId, { status: "completed" });
        await db.createKillFeedEvent({ gameId: input.gameId, eventType: "game_end", message: "🏆 Game Over!" });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ gameId: z.number(), confirmationName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        if (input.confirmationName.trim() !== game.name) throw new Error("Type the exact game name to confirm permanent deletion");
        await db.deleteGamePermanently(input.gameId);
        return { success: true };
      }),

    leaderboard: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input }) => {
        return addProtectionBadges(await db.getLeaderboard(input.gameId));
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
        if (game?.adminId === ctx.user.id || ctx.user.isSuperAdmin) return addProtectionBadges(players);
        const viewer = players.find(player => player.userId === ctx.user.id);
        if (!viewer) return [];
        await db.expirePlayerPowerUps(input.gameId);
        const blackout = (await db.getActiveGamePowerUpsByName(input.gameId, "Blackout")).length > 0;
        const hiddenIds = new Set<number>();
        if (blackout) for (const player of players) hiddenIds.add(player.id);
        const radar = await db.getActivePowerUpByName(viewer.id, "Radar");
        const vendetta = await db.getActivePowerUpByName(viewer.id, "Vendetta");
        const vendettaTargetId = vendetta?.targetPlayerId ?? null;
        const canSeeAll = Boolean(radar || (game?.purgeActive && game.showLocationsDuringPurge));
        for (const player of players) {
          if (player.id === viewer.id) continue;
          if (blackout) continue;
          if (!canSeeAll && player.id !== viewer.targetId && player.id !== vendettaTargetId) {
            hiddenIds.add(player.id);
            continue;
          }
          const isDirectTarget = player.id === viewer.targetId || player.id === vendettaTargetId;
          const hidden = await Promise.all([
            db.getActivePowerUpByName(player.id, "Dead Zone"),
            db.getActivePowerUpByName(player.id, "Witness Protection"),
            radar && !isDirectTarget ? db.getActivePowerUpByName(player.id, "Burner Phone") : Promise.resolve(undefined),
          ]);
          if (hidden.some(Boolean)) hiddenIds.add(player.id);
        }
        const visiblePlayers = players.map(player => hiddenIds.has(player.id) ? { ...player, latitude: null, longitude: null } : { ...player });
        const swaps = await db.getActiveGamePowerUpsByName(input.gameId, "Doppelganger");
        swaps.sort((a, b) => (a.activatedAt?.getTime() || a.id) - (b.activatedAt?.getTime() || b.id));
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
          if (otherPlayer.id !== viewer.id && !hiddenIds.has(otherPlayer.id)) {
            const decoy = await db.getActivePowerUpByName(otherPlayer.id, "Decoy");
            const decoyData = decoy?.activationData as { decoyLatitude?: string; decoyLongitude?: string } | null | undefined;
            if (decoyData?.decoyLatitude && decoyData?.decoyLongitude) {
              otherPlayer.latitude = decoyData.decoyLatitude;
              otherPlayer.longitude = decoyData.decoyLongitude;
            }
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
        return addProtectionBadges(withZones);
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
            radar && !isMyTarget ? db.getActivePowerUpByName(target.id, "Burner Phone") : Promise.resolve(undefined),
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
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) return undefined;
        const players = await db.getGamePlayers(input.gameId);
        const target = player.targetId ? players.find(candidate => candidate.id === player.targetId) : undefined;
        const targetName = target
          ? target.user?.displayName?.trim() || target.user?.name?.trim() || `Player #${target.userId}`
          : null;
        const [targetWithProtection] = target ? await addProtectionBadges([target]) : [];
        return { ...player, targetName, targetProtectionBadge: targetWithProtection?.protectionBadge ?? null };
      }),

    reconTarget: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ ctx, input }) => {
        const viewer = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!viewer) return null;
        const inventory = await db.getPlayerPowerUps(viewer.id);
        const currentGame = await db.getGame(input.gameId);
        const recon = inventory
          .filter(item => item.powerUp?.name === "Recon" && (item.activationData as any)?.reportRound === currentGame?.currentRound)
          .sort((a, b) => b.id - a.id)[0];
        const report = recon?.activationData as any;
        if (!recon || !report) return null;
        const players = await db.getGamePlayers(input.gameId);
        const target = players.find(p => p.id === report.targetPlayerId);
        if (!target) return null;
        return {
          targetName: target.user?.displayName || target.user?.name || `Player #${target.userId}`,
          points: Number.isFinite(Number(report.targetPoints)) ? Number(report.targetPoints) : 0,
          activePowerUps: Array.isArray(report.inventory) ? report.inventory : [],
          expiresAt: null,
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
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const id = await db.createPowerUp(input);
        return { id };
      }),

    seedAll: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const seedGame = await db.getGame(input.gameId);
        if (!seedGame || (seedGame.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const defaultPowerUps: Array<{name:string;emoji:string;effect:string;cost:number;duration:number|null;maxUsesPerGame?:number;category:"offensive"|"defensive"|"utility"|"special"|"chaos";description:string}> = [
          // === OFFENSIVE (20) ===
          { name: "Bounty", emoji: "💰", effect: "Place a 6-hour bounty on any alive player", cost: 100, duration: null, category: "offensive", description: "Place an anonymous bounty on any alive player for 6 hours. The player who eliminates them receives 200 total points for the elimination." },
          { name: "Raise the Stakes", emoji: "📈", effect: "Double a player's active bounties", cost: 350, duration: null, category: "offensive", description: "Double all active bounties on an alive player. This does not create a new bounty and every bounty keeps its original expiration time." },
          { name: "Killswitch", emoji: "💀", effect: "Strip all of the target's active power-ups (destroys ALL)", cost: 400, duration: null, category: "offensive", description: "Immediately deactivates ALL active power-ups on your current target. Shield? Gone. Ghost Mode? Disabled. Immunity Lock? Stripped. They receive a notification that their power-ups were stripped but NOT who did it." },
          { name: "Radar", emoji: "📡", effect: "Reveal all active players' locations on the map", cost: 100, duration: 120, category: "offensive", description: "For 2 hours, your map shows the real-time location of EVERY alive player, not just your target. Essentially a personal mini-purge without revealing your own location." },
          { name: "Recon", emoji: "🔍", effect: "Take a one-time snapshot of your current target", cost: 150, duration: null, category: "offensive", description: "Take a one-time snapshot of your current normal target's points and every active or unused power-up. The saved report remains available until the round ends." },
          { name: "Blacklist", emoji: "\u{1F6AB}", effect: "Block a target from catalog purchases", cost: 250, duration: 240, category: "offensive", description: "For 4 hours, your target cannot purchase power-ups from the Shop catalog. Inventory activation, gifts, map pickups, and direct Roulette spins still work. Only one Blacklist may affect a player at a time." },
          { name: "Asset Freeze", emoji: "🧊", effect: "Block a target from using power-ups", cost: 250, duration: 120, category: "offensive", description: "For 2 hours, your target cannot activate or use power-ups they already own. They may still purchase power-ups." },
          { name: "Sabotage", emoji: "🔧", effect: "Target's next power-up purchase costs double", cost: 150, duration: 360, category: "offensive", description: "The next power-up your target purchases within 6 hours costs them double the listed price. They are NOT notified of the sabotage until they make the purchase and see the inflated cost." },
          { name: "Sniper's Duel", emoji: "🎯", effect: "Mandatory real-world duel for 350 points and the loser's stake", cost: 50, duration: null, maxUsesPerGame: 1, category: "offensive", description: "Challenge any other alive player and stake an unused power-up. They must stake an unused power-up of equal or greater catalog value. Submit video or a witness and the proposed winner for admin review. The approved winner earns 350 points and the loser's stake." },
          { name: "Jackpot", emoji: "✨", effect: "Next kill earns double points (1x per game)", cost: 300, duration: 1440, maxUsesPerGame: 1, category: "offensive", description: "Your next confirmed elimination earns double the normal elimination points. Stacks with bounty points. One-time use per game, lasts up to 24hrs until triggered." },
          { name: "Bounty Hunter", emoji: "🎯", effect: "Earn 450 total points on your next bounty elimination", cost: 250, duration: 1440, maxUsesPerGame: 3, category: "offensive", description: "For up to 24 hours, your next approved elimination of a player who had an active bounty at submission time pays 450 total base-and-bounty points. Up to 3 uses per game, with no active stacking." },
          { name: "Vampire", emoji: "🧛", effect: "Bank a life for every approved elimination in the game", cost: 350, duration: 120, maxUsesPerGame: 1, category: "offensive", description: "For 2 hours, every approved elimination anywhere in the game banks one extra life for you, up to 3. Banked lives remain until used or the game ends. An active Lucky Charm is used first." },
          { name: "Smoke Screen", emoji: "💨", effect: "Hide all map power-up pickups from every active player", cost: 150, duration: 120, category: "offensive", description: "For 2 hours, ALL hidden map power-ups become invisible to every player except you. You can collect them freely while others can't even see they exist." },
          { name: "Vendetta", emoji: "⚔️", effect: "Add a second target for this round", cost: 200, duration: 360, category: "offensive", description: "Choose any other alive player as a second target for up to 6 hours. Vendetta ends when that player is eliminated or the current round ends and never carries into another round." },
          { name: "Blackout", emoji: "⚫", effect: "Remove all player locations from the map for certain time period", cost: 300, duration: 120, category: "offensive", description: "For 2 hours, NO player locations are visible on anyone's map. Even during purge, the map goes dark. Everyone is notified when Blackout starts and ends." },
          { name: "Fall Guy", emoji: "🪖", effect: "Force someone to be your bodyguard, if you're shot, they're eliminated (1x per game)", cost: 300, duration: 240, maxUsesPerGame: 1, category: "offensive", description: "Force any alive player to be your human shield for 4 hours. If someone eliminates you during this time, the conscripted player is eliminated INSTEAD. They are notified. 1x per game." },
          { name: "Hitman's Cut", emoji: "💎", effect: "Get half the qualifying points from other players' eliminations", cost: 250, duration: 240, maxUsesPerGame: 2, category: "offensive", description: "For 4 hours, receive a generated bonus equal to 50% of qualifying points from every other player's approved eliminations. Your own eliminations and Open Season's separate 50-point award do not count." },
          { name: "Frame Job", emoji: "🖼️", effect: "Transfer your bounty to someone else, if they're eliminated your bounty is fulfilled", cost: 250, duration: null, maxUsesPerGame: 1, category: "offensive", description: "Transfer all bounties currently on you to another player. The bounty stays on them for as long as it would have stayed on you — it does not expire on its own or transfer back." },
          { name: "Strip Search", emoji: "🔓", effect: "Destroy an active Immunity Shield", cost: 200, duration: null, category: "offensive", description: "Choose any alive player and permanently destroy their currently active Immunity Shield. They are told who stripped it. If no shield is active, this power-up is not consumed." },
          { name: "Boomerang", emoji: "🪃", effect: "Redirect an elimination onto the attacker", cost: 350, duration: 180, maxUsesPerGame: 1, category: "offensive", description: "For 3 hours, the first player who tries to eliminate you is eliminated by you instead. You receive the kill and points. The redirect is consumed even if their defense blocks it." },
          // === DEFENSIVE (15) ===
          { name: "Immunity Shield", emoji: "🛡️", effect: "Immunity from elimination while active", cost: 200, duration: 240, category: "defensive", description: "Activates a protective barrier. While active, any elimination attempt against you automatically fails. The attacker is NOT notified. Lasts 4 hours." },
          { name: "Dead Zone", emoji: "👻", effect: "Hide location from the map while active", cost: 150, duration: 120, category: "defensive", description: "Your location completely disappears from all maps for 2 hours — nothing is shown, not even a last-known pin. Great for ambushes or escaping hunters." },
          { name: "Clean Slate", emoji: "🧹", effect: "Remove a bounty placed on you", cost: 400, duration: null, maxUsesPerGame: 1, category: "defensive", description: "Instantly removes ALL active bounties placed on you. The bounty points vanish. Use when your bounty is climbing and you want to reduce incentive for others to target you." },
          { name: "Radar Detector", emoji: "📟", effect: "Get a generic alert when someone explicitly checks your location", cost: 125, duration: 240, category: "defensive", description: "For 4 hours, receive a generic in-app alert when someone explicitly checks your location. The alert does not identify who checked and passive map refreshes do not trigger it." },
          { name: "Revive", emoji: "❤️", effect: "Come back to life after an elimination within 2hrs. Must be used in the same round. (1x per game)", cost: 350, duration: null, maxUsesPerGame: 1, category: "defensive", description: "Come back to life after an elimination. Must be used in the round the elimination occurred and within 2 hours of the elimination. One-time use per game." },
          { name: "Untouchable", emoji: "🔒", effect: "24 active hours of public immunity", cost: 500, duration: 1440, maxUsesPerGame: 1, category: "defensive", description: "Grants 24 active hours of public immunity, once per game. It cannot start during a purge or within 24 hours of a scheduled purge. A purge that begins later pauses the timer and protection, then it resumes afterward." },
          { name: "Lucky Charm", emoji: "🍀", effect: "Auto-revive on your next approved elimination", cost: 400, duration: null, maxUsesPerGame: 3, category: "defensive", description: "Activate it and it remains ready until triggered or the game ends. Your next approved elimination still counts for the attacker, but you immediately remain alive. Lucky Charm is used before a banked Vampire life." },
          { name: "Decoy", emoji: "🎭", effect: "Display a fixed fake marker five miles from an anchor", cost: 100, duration: 120, category: "defensive", description: "For 2 hours, choose Manual and enter where you will be, or Automatic to use your current GPS. The app places a fixed decoy marker five miles from that anchor while privately retaining your real GPS." },
          { name: "Doppelganger", emoji: "📌", effect: "Swap displayed map locations with an alive player", cost: 100, duration: 120, category: "defensive", description: "Silently swap your displayed map location with any other alive player for 2 hours. While your swap is active you cannot activate Radar, Dead Zone, Burner Phone, Decoy, Witness Protection, or another Doppelganger." },
          { name: "Mirror, Mirror", emoji: "🪞", effect: "Copy an allowed active power-up for its remaining time", cost: 250, duration: null, category: "defensive", description: "Copy one compatible active power-up from another player. The original stays active and your copy receives exactly the original's remaining time, not a fresh duration." },
          { name: "Bodyguard", emoji: "💪", effect: "Protect another player from one attempt", cost: 50, duration: 240, maxUsesPerGame: 1, category: "defensive", description: "Reserve 150 of your points to protect another alive player for 4 hours. Their first otherwise-valid elimination attempt is blocked, the 150 points are deducted, and Bodyguard is consumed. Unused reserved points return at expiration. Only one external Bodyguard can protect a player." },
          { name: "Respawn", emoji: "🔄", effect: "Undo your elimination, must pay half revival fee. Within 1hr of approval", cost: 350, duration: null, maxUsesPerGame: 1, category: "defensive", description: "If eliminated, activate within 1 hour of elimination approval. You return to alive status immediately. A half revival fee is added to the admin's fee queue for you to pay." },
          { name: "Witness Protection", emoji: "🕶️", effect: "Temporary safety with location removed", cost: 250, duration: 240, category: "defensive", description: "For 4 hours, you are marked safe and cannot be eliminated, and your location is removed from the map. You may still attack." },
          { name: "Sanctuary", emoji: "⛪", effect: "Publish an admin-approved real-world safe zone", cost: 200, duration: 360, maxUsesPerGame: 1, category: "defensive", description: "Enter an address or use your current location and send it for admin approval. Once approved, a 30-meter zone appears on everyone's map for 6 hours. The app shows the zone but does not enforce real-world eliminations inside it." },
          { name: "Burner Phone", emoji: "📱", effect: "Blocks Radar from finding you", cost: 150, duration: 240, category: "defensive", description: "For 4 hours, Radar cannot grant other players access to your location." },
          // === CHAOS (9) ===
          { name: "Monkey Wrench", emoji: "🔀", effect: "Temporarily replace the admin's official safe object", cost: 100, duration: 1440, category: "chaos", description: "Replace the game's official real-world safe object for 24 hours. Everyone is notified of the temporary object; when it expires, the admin's normal safe object returns." },
          { name: "Reassignment", emoji: "🔄", effect: "Swap targets with another player's hunter", cost: 300, duration: null, maxUsesPerGame: 2, category: "chaos", description: "Choose any alive player to become your new target. Whoever currently hunts that player receives your old target in exchange. Use when your current target is too difficult." },
          { name: "Pickpocket", emoji: "🪙", effect: "Steal half an alive player's points, up to 400", cost: 250, duration: null, maxUsesPerGame: 3, category: "chaos", description: "Choose any other alive player and steal half their current points, up to 400. The named theft and exact amount appear in the public kill feed." },
          { name: "Freaky Friday", emoji: "🎭", effect: "Reassign every alive player's target for the round", cost: 600, duration: null, maxUsesPerGame: 2, category: "chaos", description: "Every alive player receives a different target. The reassignment remains one-to-one: nobody targets themselves or keeps their old target. No notification is sent." },
          { name: "Lifeline", emoji: "🚑", effect: "Revive an eliminated player from this round", cost: 400, duration: null, maxUsesPerGame: 2, category: "chaos", description: "Choose any eliminated player whose latest approved elimination was in the current round and revive them. Their elimination record and points remain. No point deduction is applied." },
          { name: "Care Package", emoji: "🎁", effect: "Gift an unused power-up to another alive player", cost: 50, duration: null, category: "chaos", description: "Transfer an unused inventory power-up to another alive player who has capacity to use it. The public feed names sender and recipient but keeps the item private." },
          { name: "Open Season", emoji: "🔫", effect: "30 minutes of real-world open targeting plus upload grace", cost: 600, duration: 40, category: "chaos", description: "All players receive a 5-minute warning, followed by 30 active minutes and a 5-minute upload grace period. Safe objects do not count in real life. You earn 50 points for each elimination submitted during the active or grace window that is later approved." },
          { name: "Roulette", emoji: "🎰", effect: "Pay 50 points and spin directly from the Shop banner", cost: 50, duration: null, category: "chaos", description: "Roulette is opened from the Shop banner. It is not purchased, stored, or activated as an inventory power-up." },
          { name: "Wildcard", emoji: "🃏", effect: "Choose your target for the next round", cost: 300, duration: null, maxUsesPerGame: 3, category: "chaos", description: "Choose which active player will be your target for the next round." },
        ];
        const ids: number[] = [];
        const usageFeesByName: Record<string, number> = {
          "Clean Slate": 500,
          "Revive": 1500,
          "Respawn": 750,
          "Witness Protection": 500,
          "Sanctuary": 500,
          "Untouchable": 500,
          "Lifeline": 500,
          "Wildcard": 500,
        };
        const existingCatalog = await db.getGamePowerUps(input.gameId);
        for (const pu of defaultPowerUps) {
          const aliases = pu.name === "Doppelganger" ? ["Doppelganger", "Doppleganger"] : pu.name === "Care Package" ? ["Care Package", "Care package"] : [pu.name];
          const existing = existingCatalog.find(candidate => aliases.includes(candidate.name));
          const values = { ...pu, usageFeeCents: usageFeesByName[pu.name] || 0, gameId: input.gameId, isEnabled: true, discount: existing?.discount || 0 };
          if (existing) {
            await db.updatePowerUp(existing.id, values);
            ids.push(existing.id);
          } else {
            ids.push(await db.createPowerUp(values));
          }
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
        // General housekeeping (flips genuinely expired rows, including
        // their Bodyguard/Witness Protection/etc. side effects) -- not
        // required for purchasePowerUpAtomic's own Blacklist/Sabotage
        // check below, which filters by expiry itself regardless of
        // whether this has run yet.
        await db.expirePlayerPowerUps(input.gameId);
        // Every part of the purchase decision -- catalog cost/discount/
        // enabled state, max-use eligibility, active Blacklist/Sabotage,
        // the pending coupon, and the balance itself -- is re-derived from
        // scratch inside this call, strictly after it locks the player's
        // row. Nothing computed out here would be trustworthy against a
        // concurrent purchase; see purchasePowerUpAtomic's own comment.
        const { inventoryId, cost } = await db.purchasePowerUpAtomic({
          gamePlayerId: player.id,
          gameId: input.gameId,
          powerUpId: input.powerUpId,
        });
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

        const gameBeforePayment = await db.getGame(input.gameId);
        if (item.powerUp.name === "Clean Slate" && !(await db.getGameBounties(input.gameId)).some(bounty => bounty.targetPlayerId === player.id)) {
          throw new Error("You have no active bounties to clear");
        }
        if (["Revive", "Respawn"].includes(item.powerUp.name)) {
          const latest = await db.getLatestApprovedEliminationForPlayer(input.gameId, player.id);
          const limit = item.powerUp.name === "Revive" ? 2 * 60 * 60 * 1000 : 60 * 60 * 1000;
          if (!latest || player.status !== "eliminated" || !latest.reviewedAt || Date.now() - latest.reviewedAt.getTime() > limit || (item.powerUp.name === "Revive" && latest.round !== (gameBeforePayment?.currentRound || 1))) {
            throw new Error(`${item.powerUp.name} is not available for your latest elimination`);
          }
        }

        if (item.powerUp.name === "Roulette") throw new Error("Roulette is played directly from the Shop banner and cannot be activated from inventory");

        if ((item.powerUp.usageFeeCents || 0) > 0) {
          const fee = await db.getPowerUpUsageFee(item.id);
          if (!fee) {
            await db.createPowerUpUsageFee({
              gameId: input.gameId,
              gamePlayerId: player.id,
              playerPowerUpId: item.id,
              amountCents: item.powerUp.usageFeeCents || 0,
              status: "pending",
            });
          }
        }

        const targetRequired = new Set([
          "Bounty", "Raise the Stakes", "Blacklist", "Asset Freeze", "Sabotage",
          "Sniper's Duel", "Fall Guy", "Frame Job", "Strip Search", "Doppelganger", "Mirror, Mirror", "Bodyguard", "Pickpocket",
          "Lifeline", "Care Package", "Wildcard", "Vendetta", "Reassignment"
        ]);
        if (targetRequired.has(item.powerUp.name) && !input.targetPlayerId) throw new Error("Choose a target before activating this power-up");
        if (input.targetPlayerId) {
          const target = await db.getPlayerById(input.targetPlayerId);
          if (!target || target.gameId !== input.gameId) throw new Error("Invalid target player");
          if (item.powerUp.name !== "Lifeline" && target.status !== "alive") throw new Error("Choose an alive player");
          if (target.id === player.id && !["Revive", "Respawn"].includes(item.powerUp.name)) throw new Error("You cannot choose yourself");
        }

        const game = await db.getGame(input.gameId);
        if (item.powerUp.name === "Killswitch") input.targetPlayerId = player.targetId || undefined;
        if (item.powerUp.name === "Recon") input.targetPlayerId = player.targetId || undefined;
        if (["Killswitch", "Recon"].includes(item.powerUp.name) && !input.targetPlayerId) throw new Error("You do not have a current target");
        if (["Blacklist", "Asset Freeze", "Sabotage"].includes(item.powerUp.name) && await db.getActiveTargetedPowerUp(input.gameId, input.targetPlayerId!, item.powerUp.name)) {
          throw new Error(`${item.powerUp.name} is already active on that player`);
        }
        if (["Jackpot", "Bounty Hunter", "Hitman's Cut", "Immunity Shield", "Radar Detector"].includes(item.powerUp.name) && await db.getActivePowerUpByName(player.id, item.powerUp.name)) {
          throw new Error(`${item.powerUp.name} is already active`);
        }
        if (["Immunity Shield", "Untouchable"].includes(item.powerUp.name) && (await db.getActivePowerUpByName(player.id, "Immunity Shield") || await db.getActivePowerUpByName(player.id, "Untouchable"))) {
          throw new Error("You already have an immunity power-up active");
        }
        const ownDoppelganger = await db.getActivePowerUpByName(player.id, "Doppelganger");
        if (ownDoppelganger && ["Radar", "Dead Zone", "Burner Phone", "Decoy", "Witness Protection", "Doppelganger"].includes(item.powerUp.name)) {
          throw new Error(`${item.powerUp.name} cannot be activated while your Doppelganger swap is active`);
        }
        if (item.powerUp.name === "Doppelganger") {
          for (const incompatible of ["Radar", "Dead Zone", "Burner Phone", "Decoy", "Witness Protection", "Doppelganger"]) {
            if (await db.getActivePowerUpByName(player.id, incompatible)) throw new Error(`End ${incompatible} before activating Doppelganger`);
          }
        }
        if (["Untouchable", "Bodyguard", "Sanctuary"].includes(item.powerUp.name) && game?.purgeActive) {
          throw new Error(`${item.powerUp.name} cannot be activated during a purge`);
        }
        if (item.powerUp.name === "Untouchable" && game?.purgeScheduledAt && game.purgeScheduledAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000) {
          throw new Error("Untouchable cannot start within 24 hours of a scheduled purge");
        }

        let consumeImmediately = item.powerUp.duration == null;
        let finalActivationData: Record<string, unknown> | undefined = input.activationData;
        let effectiveDurationMinutes: number | null = item.powerUp.duration;
        switch (item.powerUp.name) {
          case "Open Season": {
            const window = openSeasonWindow(Date.now());
            finalActivationData = { effectStartsAt: new Date(window.startsAt).toISOString(), activeEndsAt: new Date(window.activeEndsAt).toISOString(), submissionsCloseAt: new Date(window.submissionsCloseAt).toISOString() };
            effectiveDurationMinutes = 40;
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
            await sendPushToUsers(allPlayers.map(gamePlayer => gamePlayer.userId), { title: "🔫 Open Season Incoming", body: "Starts in 5 minutes, runs for 30 minutes, then allows 5 minutes for video uploads.", data: { type: "open_season", gameId: input.gameId } });
            break;
          }
          case "Blackout": {
            const allPlayers = await db.getGamePlayers(input.gameId);
            for (const gamePlayer of allPlayers) await db.createNotification({ userId: gamePlayer.userId, gameId: input.gameId, type: "power_up_used", title: "Blackout Active", body: "All player locations are hidden for 2 hours." });
            await sendPushToUsers(allPlayers.map(gamePlayer => gamePlayer.userId), { title: "⚫ Blackout Active", body: "All player locations are hidden for 2 hours.", data: { type: "blackout", gameId: input.gameId } });
            break;
          }
          case "Sniper's Duel": {
            if (!input.targetPlayerId) throw new Error("Choose an opponent before activating this power-up");
            const challengerStakeId = Number(input.activationData?.challengerStakeId);
            const stake = await db.getPlayerPowerUpById(challengerStakeId);
            if (!stake || stake.gamePlayerId !== player.id || stake.status !== "inventory" || stake.lockedForDuelId || stake.powerUp?.name === "Sniper's Duel") throw new Error("Choose an unused power-up to stake");
            const opponentInventory = await db.getPlayerPowerUps(input.targetPlayerId);
            if (!opponentInventory.some(candidate => candidate.status === "inventory" && !candidate.lockedForDuelId && candidate.powerUp?.name !== "Sniper's Duel" && (candidate.powerUp?.cost || 0) >= (stake.powerUp?.cost || 0))) throw new Error("That opponent has no eligible equal-or-higher-value stake");
            const duelId = await db.createDuel({ gameId: input.gameId, challengerId: player.id, opponentId: input.targetPlayerId, challengerStakeId, stakeDeadline: new Date(Date.now() + 60 * 60 * 1000) });
            const opponent = await db.getPlayerById(input.targetPlayerId);
            const challengerName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || `Player #${player.userId}`;
            if (opponent) {
              await db.createNotification({
                userId: opponent.userId,
                gameId: input.gameId,
                type: "power_up_used",
                title: "🎯 You've Been Challenged!",
                body: `${challengerName} challenged you to a mandatory Sniper's Duel. Choose an unused power-up worth at least ${stake.powerUp?.cost || 0} points within 1 hour.`,
              });
              await sendPushToUser(opponent.userId, { title: "🎯 Sniper's Duel Challenge", body: `${challengerName} challenged you. Choose your stake within 1 hour.`, data: { type: "snipers_duel", gameId: input.gameId, duelId } });
            }
            await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: player.id, targetId: input.targetPlayerId, message: `${challengerName} issued a Sniper's Duel challenge!` });
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
              address: typeof input.activationData?.address === "string" ? input.activationData.address : null,
              zoneRadiusMeters: 30,
              approved: false,
            };
            effectiveDurationMinutes = null;
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
            const mode = input.activationData?.mode === "manual" ? "manual" : "automatic";
            const anchorLatitude = mode === "manual" ? Number(input.activationData?.anchorLatitude) : Number(player.latitude);
            const anchorLongitude = mode === "manual" ? Number(input.activationData?.anchorLongitude) : Number(player.longitude);
            if (!Number.isFinite(anchorLatitude) || !Number.isFinite(anchorLongitude)) throw new Error(mode === "manual" ? "Enter and locate a valid address" : "Enable your location before using Decoy");
            const decoy = pointFiveMilesAway(anchorLatitude, anchorLongitude);
            finalActivationData = { mode, address: input.activationData?.address || null, anchorLatitude: String(anchorLatitude), anchorLongitude: String(anchorLongitude), decoyLatitude: decoy.latitude.toFixed(6), decoyLongitude: decoy.longitude.toFixed(6) };
            break;
          }
          case "Bounty":
            await db.createBounty({
              gameId: input.gameId,
              targetPlayerId: input.targetPlayerId!,
              placedByPlayerId: player.id,
              amount: 100,
            });
            break;
          case "Raise the Stakes":
            await db.doublePlayerBounties(input.gameId, input.targetPlayerId!, player.id);
            break;
          case "Killswitch":
            if (await db.deactivateAllPlayerPowerUps(input.targetPlayerId!, ["Sanctuary"]) === 0) throw new Error("Your current target has no eligible active power-ups");
            {
              const victim = await db.getPlayerById(input.targetPlayerId!);
              if (victim) await db.createNotification({ userId: victim.userId, gameId: input.gameId, type: "power_up_used", title: "Killswitch", body: "Someone destroyed your active power-ups. Sanctuary was not affected." });
            }
            break;
          case "Recon": {
            const target = await db.getPlayerById(input.targetPlayerId!);
            if (!target) throw new Error("Current target not found");
            const inventory = await db.getPlayerPowerUps(target.id);
            finalActivationData = {
              reportRound: game?.currentRound || 0,
              targetPlayerId: target.id,
              targetPoints: target.points || 0,
              inventory: inventory
                .filter(candidate => ["inventory", "pending_payment", "active"].includes(candidate.status))
                .map(candidate => ({ name: candidate.powerUp?.name, emoji: candidate.powerUp?.emoji, status: candidate.status, expiresAt: candidate.expiresAt?.toISOString() || null })),
            };
            break;
          }
          case "Clean Slate":
            if (!(await db.getGameBounties(input.gameId)).some(bounty => bounty.targetPlayerId === player.id)) throw new Error("You have no active bounties to clear");
            await db.clearPlayerBounties(input.gameId, player.id);
            break;
          case "Witness Protection":
            await db.updatePlayer(player.id, { status: "safe" });
            break;
          case "Strip Search": {
            const immunity = await db.getActivePowerUpByName(input.targetPlayerId!, "Immunity Shield");
            if (!immunity) throw new Error("The selected player has no active Immunity Shield");
            await db.consumePlayerPowerUp(immunity.id);
            const target = await db.getPlayerById(input.targetPlayerId!);
            const actorName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || "A player";
            if (target) await db.createNotification({ userId: target.userId, gameId: input.gameId, type: "power_up_used", title: "Immunity Shield Destroyed", body: `${actorName} destroyed your Immunity Shield.` });
            break;
          }
          case "Frame Job":
            await db.transferPlayerBounties(input.gameId, player.id, input.targetPlayerId!);
            break;
          case "Mirror, Mirror": {
            const targetInventory = await db.getPlayerPowerUps(input.targetPlayerId!);
            const allowed = new Set(["Radar", "Recon", "Jackpot", "Bounty Hunter", "Vampire", "Hitman's Cut", "Immunity Shield", "Dead Zone", "Radar Detector", "Lucky Charm", "Burner Phone", "Untouchable"]);
            const requestedId = Number(input.activationData?.copyInventoryId);
            const copied = targetInventory.find(candidate => candidate.status === "active" && allowed.has(candidate.powerUp?.name || "") && (!requestedId || candidate.id === requestedId));
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
            await db.repairTargetChainAfterRevive(input.gameId, player.id);
            const reviveName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || `Player #${player.userId}`;
            await db.createKillFeedEvent({ gameId: input.gameId, eventType: "revival", actorId: player.id, message: `${reviveName} used Revive and returned to the game!` });
            await db.createNotification({ userId: player.userId, gameId: input.gameId, type: "revival", title: "Revive Activated", body: "You are alive again. Your elimination record and the attacker's points remain." });
            await sendPushToUser(player.userId, { title: "❤️ Revived", body: "You are back in the game.", data: { type: "revival", gameId: input.gameId } });
            break;
          }
          case "Respawn": {
            const latest = await db.getLatestApprovedEliminationForPlayer(input.gameId, player.id);
            if (!latest || !latest.reviewedAt || Date.now() - latest.reviewedAt.getTime() > 60 * 60 * 1000) {
              throw new Error("Respawn must be used within 1 hour of elimination approval");
            }
            await db.updatePlayer(player.id, { status: "alive" });
            await db.repairTargetChainAfterRevive(input.gameId, player.id);
            const respawnName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || `Player #${player.userId}`;
            await db.createKillFeedEvent({ gameId: input.gameId, eventType: "revival", actorId: player.id, message: `${respawnName} used Respawn and returned to the game!` });
            await db.createNotification({ userId: player.userId, gameId: input.gameId, type: "revival", title: "Respawn Activated", body: "You are alive again. A $7.50 fee was added to the admin queue." });
            break;
          }
          case "Pickpocket": {
            const target = await db.getPlayerById(input.targetPlayerId!);
            if (!target) throw new Error("Target not found");
            const stolen = Math.min(400, Math.floor((target.points || 0) / 2));
            await db.updatePlayer(target.id, { points: (target.points || 0) - stolen });
            await db.updatePlayer(player.id, { points: (player.points || 0) + stolen });
            const targetPlayers = await db.getGamePlayers(input.gameId);
            const targetWithUser = targetPlayers.find(candidate => candidate.id === target.id);
            const actorName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || `Player #${player.userId}`;
            const targetName = targetWithUser?.user?.displayName?.trim() || targetWithUser?.user?.name?.trim() || `Player #${target.userId}`;
            await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: player.id, targetId: target.id, message: `${actorName} stole ${stolen} points from ${targetName}!` });
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
            const assignments = derangedTargetPermutation(alive.map(candidate => ({ id: candidate.id, targetId: candidate.targetId })));
            for (const assignment of assignments) await db.updatePlayer(assignment.playerId, { targetId: assignment.targetId });
            break;
          }
          case "Monkey Wrench": {
            const safeObject = String(input.activationData?.safeObject || "").trim();
            if (!safeObject) throw new Error("Choose the replacement safe object");
            if (game?.temporarySafeObjectExpiresAt && game.temporarySafeObjectExpiresAt.getTime() > Date.now()) throw new Error("A Monkey Wrench safe object is already active");
            await db.updateGame(input.gameId, { temporarySafeObject: safeObject, temporarySafeObjectExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
            const allPlayers = await db.getGamePlayers(input.gameId);
            for (const gamePlayer of allPlayers) await db.createNotification({ userId: gamePlayer.userId, gameId: input.gameId, type: "power_up_used", title: "Safe Object Changed", body: `The official safe object is now “${safeObject}” for 24 hours.` });
            await sendPushToUsers(allPlayers.map(gamePlayer => gamePlayer.userId), { title: "🔀 Safe Object Changed", body: `Use “${safeObject}” for the next 24 hours.`, data: { type: "monkey_wrench", gameId: input.gameId } });
            break;
          }
          case "Lifeline": {
            const revived = await db.getPlayerById(input.targetPlayerId!);
            const latest = await db.getLatestApprovedEliminationForPlayer(input.gameId, input.targetPlayerId!);
            if (!revived || revived.status !== "eliminated" || !latest || latest.round !== (game?.currentRound || 1)) throw new Error("Choose a player eliminated during the current round");
            await db.updatePlayer(input.targetPlayerId!, { status: "alive" });
            await db.repairTargetChainAfterRevive(input.gameId, input.targetPlayerId!);
            const revivedPlayers = await db.getGamePlayers(input.gameId);
            const revivedWithUser = revivedPlayers.find(candidate => candidate.id === input.targetPlayerId);
            const revivedName = revivedWithUser?.user?.displayName?.trim() || revivedWithUser?.user?.name?.trim() || `Player #${input.targetPlayerId}`;
            await db.createKillFeedEvent({ gameId: input.gameId, eventType: "revival", actorId: player.id, targetId: input.targetPlayerId, message: `${revivedName} was revived!` });
            if (revived) {
              await db.createNotification({ userId: revived.userId, gameId: input.gameId, type: "revival", title: "You've Been Revived", body: "Lifeline returned you to the current round." });
              await sendPushToUser(revived.userId, { title: "❤️ You've Been Revived", body: "Lifeline returned you to the game.", data: { type: "revival", gameId: input.gameId } });
            }
            break;
          }
          case "Wildcard":
            if (await db.getActivePowerUpByName(player.id, "Wildcard")) throw new Error("You already have a Wildcard waiting for the next round");
            consumeImmediately = false;
            effectiveDurationMinutes = null;
            finalActivationData = { scheduledForRound: (game?.currentRound || 0) + 1 };
            break;
          case "Care Package": {
            const giftInventoryId = Number(input.activationData?.giftInventoryId);
            if (!giftInventoryId || giftInventoryId === item.id) throw new Error("Choose an inventory item to gift");
            const gift = await db.getPlayerPowerUpById(giftInventoryId);
            if (!gift || gift.gamePlayerId !== player.id || gift.status !== "inventory" || gift.lockedForDuelId) throw new Error("Gift item is not available");
            const giftMax = gift.powerUp?.maxUsesPerGame;
            if (giftMax != null && await db.getPlayerPowerUpUsageCount(input.targetPlayerId!, gift.powerUpId, input.gameId) >= giftMax) throw new Error("That player has already reached this power-up's game limit");
            await db.transferPlayerPowerUp(gift.id, input.targetPlayerId!);
            const players = await db.getGamePlayers(input.gameId);
            const recipient = players.find(candidate => candidate.id === input.targetPlayerId);
            const senderName = ctx.user.displayName?.trim() || ctx.user.name?.trim() || `Player #${player.userId}`;
            const recipientName = recipient?.user?.displayName?.trim() || recipient?.user?.name?.trim() || "another player";
            await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: player.id, targetId: input.targetPlayerId, message: `${senderName} sent a power-up to ${recipientName}!` });
            break;
          }
          case "Bodyguard": {
            if ((player.points || 0) - (player.reservedPoints || 0) < 150) throw new Error("Bodyguard requires 150 available points to reserve");
            if (await db.getActiveTargetedPowerUp(input.gameId, input.targetPlayerId!, "Bodyguard")) throw new Error("That player already has Bodyguard protection");
            await db.updatePlayer(player.id, { reservedPoints: (player.reservedPoints || 0) + 150 });
            break;
          }
          case "Lucky Charm":
            consumeImmediately = false;
            effectiveDurationMinutes = null;
            break;
        }

        if (consumeImmediately) {
          if (finalActivationData) await db.updatePlayerPowerUpActivationData(item.id, finalActivationData);
          await db.consumePlayerPowerUp(item.id);
        } else {
          const expiresAt = effectiveDurationMinutes == null ? null : new Date(Date.now() + effectiveDurationMinutes * 60000);
          await db.activatePlayerPowerUp(item.id, { expiresAt, targetPlayerId: input.targetPlayerId, activationData: finalActivationData, activatedRound: game?.currentRound || 0 });
        }
        const silent = new Set(["Radar", "Recon", "Blacklist", "Asset Freeze", "Sabotage", "Sniper's Duel", "Vampire", "Smoke Screen", "Vendetta", "Fall Guy", "Hitman's Cut", "Dead Zone", "Radar Detector", "Lucky Charm", "Decoy", "Doppelganger", "Mirror, Mirror", "Bodyguard", "Witness Protection", "Burner Phone", "Reassignment", "Freaky Friday", "Lifeline", "Care Package", "Wildcard"]);
        if (!silent.has(item.powerUp.name)) {
          const anonymous = new Set(["Killswitch", "Blackout", "Boomerang", "Clean Slate", "Monkey Wrench"]);
          await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: anonymous.has(item.powerUp.name) ? null : player.id, targetId: anonymous.has(item.powerUp.name) ? null : input.targetPlayerId, message: anonymous.has(item.powerUp.name) ? `Someone activated ${item.powerUp.name}!` : `${item.powerUp.emoji} ${item.powerUp.name} activated!` });
        }
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
        await db.approveSanctuaryPowerUp(item.id, { ...activationData, approved: true });
        const holder = await db.getPlayerById(item.gamePlayerId);
        if (holder) {
          await db.createNotification({ userId: holder.userId, gameId: input.gameId, type: "power_up_used", title: "⛪ Sanctuary Approved", body: "Your Sanctuary was approved and now shows as a safe zone on the map." });
        }
        return { success: true };
      }),

    rejectSanctuary: protectedProcedure
      .input(z.object({ gameId: z.number(), inventoryId: z.number(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const item = await db.getPlayerPowerUpById(input.inventoryId);
        if (!item || item.gameId !== input.gameId || item.powerUp?.name !== "Sanctuary") throw new Error("Sanctuary request not found");
        await db.returnPowerUpToInventory(item.id);
        const holder = await db.getPlayerById(item.gamePlayerId);
        if (holder) await db.createNotification({ userId: holder.userId, gameId: input.gameId, type: "power_up_used", title: "Sanctuary Needs Changes", body: input.reason?.trim() || "The admin rejected this location. Your Sanctuary was returned so you can submit another address." });
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
        const eliminated = await db.getPlayerById(input.eliminatedId);
        if (!game || !eliminated || eliminated.gameId !== input.gameId || eliminated.status !== "alive" || eliminated.id === player.id) throw new Error("Choose another alive player");
        if (!input.videoUrl || input.videoUrl === "pending-upload") throw new Error("Upload the elimination video before submitting");
        if (!isValidEliminationVideoUrl(input.videoUrl, input.gameId)) throw new Error("Video URL is invalid or wasn't uploaded through this app");
        await db.expirePlayerPowerUps(input.gameId);
        const vendetta = await db.getActivePowerUpByName(player.id, "Vendetta");
        const openSeason = (await db.getActiveGamePowerUpsByName(input.gameId, "Open Season")).some(holder => {
          const data = holder.activationData as { effectStartsAt?: string; submissionsCloseAt?: string } | null;
          return data?.effectStartsAt && data?.submissionsCloseAt && Date.now() >= new Date(data.effectStartsAt).getTime() && Date.now() <= new Date(data.submissionsCloseAt).getTime();
        });
        const canTarget = game.purgeActive || openSeason || player.targetId === eliminated.id || vendetta?.targetPlayerId === eliminated.id;
        if (!canTarget) throw new Error("That player is not currently an eligible target");
        const bountyPointsAtSubmission = (await db.getGameBounties(input.gameId)).filter(bounty => bounty.targetPlayerId === eliminated.id).reduce((sum, bounty) => sum + bounty.amount, 0);
        const id = await db.createElimination({
          gameId: input.gameId,
          eliminatorId: player.id,
          eliminatedId: input.eliminatedId,
          videoUrl: input.videoUrl,
          round: game?.currentRound || 1,
          basePointsAtSubmission: (game.purgeActive ? game.purgeEliminationPoints : null) ?? game.eliminationPoints ?? 100,
          bountyPointsAtSubmission,
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
        const originalVictimId = submittedElimination?.eliminatedId;
        let fallGuyRedirected = false;
        if (approved && submittedElimination) {
          await db.expirePlayerPowerUps(input.gameId);
          for (const protectionName of ["Immunity Shield", "Untouchable", "Witness Protection"]) {
            const protection = await db.getActivePowerUpByName(submittedElimination.eliminatedId, protectionName);
            if (protection) {
              approved = false;
              const protectedPlayer = await db.getPlayerById(submittedElimination.eliminatedId);
              if (protectedPlayer) await db.createNotification({ userId: protectedPlayer.userId, gameId: input.gameId, type: "power_up_used", title: `${protectionName} Protected You`, body: "An elimination submission against you was blocked." });
              break;
            }
          }
          if (!approved) submittedElimination = await db.getElimination(input.eliminationId);
        }
        if (approved && submittedElimination) {
          const fallGuy = await db.getActivePowerUpByName(submittedElimination.eliminatedId, "Fall Guy");
          if (fallGuy?.targetPlayerId) {
            fallGuyRedirected = true;
            await db.updateElimination(input.eliminationId, { eliminatedId: fallGuy.targetPlayerId });
            await db.consumePlayerPowerUp(fallGuy.id);
            submittedElimination = await db.getElimination(input.eliminationId);
          }
          if (submittedElimination) {
            const boomerang = await db.getActivePowerUpByName(submittedElimination.eliminatedId, "Boomerang");
            if (boomerang) {
              const boomerangHolderId = submittedElimination.eliminatedId;
              await db.updateElimination(input.eliminationId, { eliminatorId: boomerangHolderId, eliminatedId: submittedElimination.eliminatorId });
              await db.consumePlayerPowerUp(boomerang.id);
              submittedElimination = await db.getElimination(input.eliminationId);
            }
          }
          if (submittedElimination) {
            if (submittedElimination.eliminatedId !== originalVictimId) {
              for (const protectionName of ["Immunity Shield", "Untouchable", "Witness Protection"]) {
                if (await db.getActivePowerUpByName(submittedElimination.eliminatedId, protectionName)) { approved = false; break; }
              }
            }
          }
          if (approved && submittedElimination) {
            const bodyguard = await db.getActiveTargetedPowerUp(input.gameId, submittedElimination.eliminatedId, "Bodyguard");
            if (bodyguard) {
              approved = false;
              const bodyguardPlayer = await db.getPlayerById(bodyguard.gamePlayerId);
              if (bodyguardPlayer) await db.updatePlayer(bodyguardPlayer.id, { points: Math.max(0, (bodyguardPlayer.points || 0) - 150), reservedPoints: Math.max(0, (bodyguardPlayer.reservedPoints || 0) - 150) });
              await db.consumePlayerPowerUp(bodyguard.id);
              await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: bodyguard.gamePlayerId, targetId: submittedElimination.eliminatedId, message: "Bodyguard blocked an elimination!" });
            }
          }
        }
        const status = approved ? "approved" : "denied";
        const game = await db.getGame(input.gameId);
        const originalSubmission = submittedElimination || await db.getElimination(input.eliminationId);
        const eliminationPoints = originalSubmission?.basePointsAtSubmission ?? game?.eliminationPoints ?? 100;
        await db.updateElimination(input.eliminationId, { status, reviewedBy: ctx.user.id, reviewedAt: new Date(), pointsAwarded: approved ? eliminationPoints : 0 });
        
        if (approved) {
          const elim = await db.getElimination(input.eliminationId);
          if (elim) {
            // Award points to eliminator
            const players = await db.getGamePlayers(input.gameId);
            const eliminator = players.find(p => p.id === elim.eliminatorId);
            const eliminated = players.find(p => p.id === elim.eliminatedId);
            if (eliminator) {
              const jackpot = await db.getPowerUpEligibleAt(eliminator.id, "Jackpot", elim.createdAt);
              const hasBounty = (elim.bountyPointsAtSubmission || 0) > 0;
              const bountyHunter = hasBounty ? await db.getPowerUpEligibleAt(eliminator.id, "Bounty Hunter", elim.createdAt) : undefined;
              const awards = calculateKillAwards({ basePoints: eliminationPoints, jackpot: Boolean(jackpot), bountyActive: hasBounty, bountyHunter: Boolean(bountyHunter), bountyBonusPoints: elim.bountyPointsAtSubmission || 0 });
              if (jackpot) await db.consumePlayerPowerUp(jackpot.id);
              if (bountyHunter) await db.consumePlayerPowerUp(bountyHunter.id);
              let totalAward = awards.total;
              // Claim any bounties on the eliminated player
              if (eliminated) {
                if (hasBounty) {
                  await db.claimBounties(input.gameId, eliminated.id, eliminator.id);
                  await db.createKillFeedEvent({ gameId: input.gameId, eventType: "bounty_claimed", actorId: eliminator.id, targetId: eliminated.id, message: "💰 Bounty claimed!" });
                }
              }
              await db.updatePlayer(eliminator.id, { points: (eliminator.points || 0) + totalAward, kills: (eliminator.kills || 0) + 1 });
              const cuts = (await db.getGamePowerUpActivationsByName(input.gameId, "Hitman's Cut")).filter(cut => cut.activatedAt! <= elim.createdAt && (!cut.expiresAt || cut.expiresAt >= elim.createdAt));
              for (const cut of cuts) {
                if (cut.gamePlayerId === eliminator.id) continue;
                const beneficiary = players.find(p => p.id === cut.gamePlayerId);
                if (beneficiary) await db.updatePlayer(beneficiary.id, { points: (beneficiary.points || 0) + Math.floor(totalAward / 2) });
              }
              const openSeasonHolders = await db.getGamePowerUpActivationsByName(input.gameId, "Open Season");
              for (const holder of openSeasonHolders) {
                if (!holder.activatedAt || !isOpenSeasonSubmissionEligible(elim.createdAt.getTime(), holder.activatedAt.getTime())) continue;
                const holderPlayer = await db.getPlayerById(holder.gamePlayerId);
                if (holderPlayer) await db.updatePlayer(holderPlayer.id, { points: (holderPlayer.points || 0) + 50 });
              }
              // Inherit target if enabled
              const pendingLucky = eliminated ? await db.getActivePowerUpByName(eliminated.id, "Lucky Charm") : undefined;
              const willAutoRevive = Boolean(pendingLucky || (eliminated?.reviveCredits || 0) > 0);
              const eliminatorVendetta = await db.getActivePowerUpByName(eliminator.id, "Vendetta");
              const isVendettaKill = eliminatorVendetta?.targetPlayerId === eliminated?.id;
              if (game?.inheritTarget && eliminated && !willAutoRevive) {
                const inheritedTarget = eliminated.targetId;
                if (isVendettaKill || fallGuyRedirected) {
                  const normalHunter = players.find(candidate => candidate.targetId === eliminated.id && candidate.id !== eliminator.id);
                  if (normalHunter && inheritedTarget && inheritedTarget !== normalHunter.id) await db.updatePlayer(normalHunter.id, { targetId: inheritedTarget });
                } else if (inheritedTarget && inheritedTarget !== eliminator.id) {
                  await db.updatePlayer(eliminator.id, { targetId: inheritedTarget });
                  await db.createNotification({ userId: eliminator.userId, gameId: input.gameId, type: "new_target", title: "New Target Assigned", body: "You've inherited your victim's target!" });
                }
              }
              if (eliminated) {
                const vendettas = await db.getActiveGamePowerUpsByName(input.gameId, "Vendetta");
                for (const vendetta of vendettas) if (vendetta.targetPlayerId === eliminated.id) await db.consumePlayerPowerUp(vendetta.id);
              }
              // Notify eliminator (in-app + push)
              await db.createNotification({ userId: eliminator.userId, gameId: input.gameId, type: "elimination_approved", title: "Elimination Approved!", body: `+${totalAward} points awarded.` });
              await sendPushToUser(eliminator.userId, {
                title: "✅ Elimination Approved!",
                body: `+${totalAward} points awarded. Keep hunting.`,
                data: { type: "elimination_approved", gameId: input.gameId },
              });
            }
            if (eliminated) {
              const reviveCredits = (eliminated as any).reviveCredits || 0;
              const luckyCharm = await db.getActivePowerUpByName(eliminated.id, "Lucky Charm");
              if (luckyCharm) {
                await db.consumePlayerPowerUp(luckyCharm.id);
                await db.updatePlayer(eliminated.id, { status: "alive", deaths: (eliminated.deaths || 0) + 1 });
                await db.createNotification({ userId: eliminated.userId, gameId: input.gameId, type: "elimination_result", title: "🍀 Lucky Charm Saved You!", body: "You were eliminated, but your Lucky Charm revived you instantly." });
                await sendPushToUser(eliminated.userId, {
                  title: "🍀 Lucky Charm Saved You!",
                  body: "You were eliminated but your Lucky Charm brought you back instantly.",
                  data: { type: "lucky_charm_revive", gameId: input.gameId },
                });
              } else if (reviveCredits > 0) {
                await db.updatePlayer(eliminated.id, { status: "alive", deaths: (eliminated.deaths || 0) + 1, reviveCredits: reviveCredits - 1 } as any);
                await db.createNotification({ userId: eliminated.userId, gameId: input.gameId, type: "elimination_result", title: "🧛 Vampire Saved You!", body: "You were eliminated, but a banked life brought you back instantly." });
                await sendPushToUser(eliminated.userId, { title: "🧛 Extra Life Used!", body: "A banked Vampire life revived you instantly.", data: { type: "vampire_revive", gameId: input.gameId } });
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
            const vampires = (await db.getGamePowerUpActivationsByName(input.gameId, "Vampire")).filter(vampire => vampire.activatedAt! <= elim.createdAt && (!vampire.expiresAt || vampire.expiresAt >= elim.createdAt));
            for (const vampire of vampires) {
              if (vampire.gamePlayerId === elim.eliminatedId) continue;
              const holder = await db.getPlayerById(vampire.gamePlayerId);
              if (holder && (holder.reviveCredits || 0) < 3) {
                const credits = (holder.reviveCredits || 0) + 1;
                await db.updatePlayer(holder.id, { reviveCredits: credits });
                await db.createNotification({ userId: holder.userId, gameId: input.gameId, type: "power_up_used", title: "🧛 Vampire Life Banked", body: `You now have ${credits} banked ${credits === 1 ? "life" : "lives"}.` });
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

  }),

  storage: router({
    // Client uploads the video straight to Cloudinary using this signature —
    // the file never passes through our server (avoids the old base64/JSON
    // upload path's memory and body-size-limit problems for large videos).
    getEliminationUploadSignature: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!await db.getPlayerInGame(input.gameId, ctx.user.id)) throw new Error("Not in this game");
        checkUploadSignatureRateLimit(ctx.user.id);
        return getCloudinaryUploadSignature(`eliminations/${input.gameId}`);
      }),
  }),

  duel: router({
    mine: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) return [];
        const playerDuels = await db.getPlayerDuels(input.gameId, player.id);
        for (const duel of playerDuels) {
          if (duel.status !== "awaiting_opponent_stake" || !duel.stakeDeadline || duel.stakeDeadline.getTime() > Date.now() || !duel.challengerStakeId) continue;
          const challengerStake = await db.getPlayerPowerUpById(duel.challengerStakeId);
          const eligible = (await db.getPlayerPowerUps(duel.opponentId)).filter(candidate => candidate.status === "inventory" && !candidate.lockedForDuelId && candidate.powerUp?.name !== "Sniper's Duel" && (candidate.powerUp?.cost || 0) >= (challengerStake?.powerUp?.cost || 0));
          eligible.sort((a, b) => (a.powerUp?.cost || 0) - (b.powerUp?.cost || 0));
          if (eligible[0]) await db.setDuelOpponentStake(duel.id, eligible[0].id);
        }
        const refreshed = await db.getPlayerDuels(input.gameId, player.id);
        return Promise.all(refreshed.map(async duel => ({ ...duel, challengerStake: duel.challengerStakeId ? await db.getPlayerPowerUpById(duel.challengerStakeId) : null, opponentStake: duel.opponentStakeId ? await db.getPlayerPowerUpById(duel.opponentStakeId) : null })));
      }),

    chooseStake: protectedProcedure
      .input(z.object({ gameId: z.number(), duelId: z.number(), inventoryId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        const duel = await db.getDuel(input.duelId);
        if (!player || !duel || duel.gameId !== input.gameId || duel.opponentId !== player.id || duel.status !== "awaiting_opponent_stake") throw new Error("This duel is not awaiting your stake");
        const challengerStake = duel.challengerStakeId ? await db.getPlayerPowerUpById(duel.challengerStakeId) : undefined;
        const stake = await db.getPlayerPowerUpById(input.inventoryId);
        if (!stake || stake.gamePlayerId !== player.id || stake.status !== "inventory" || stake.lockedForDuelId || stake.powerUp?.name === "Sniper's Duel" || (stake.powerUp?.cost || 0) < (challengerStake?.powerUp?.cost || 0)) throw new Error("Choose an unused equal-or-higher-value power-up");
        await db.setDuelOpponentStake(duel.id, stake.id);
        return { success: true };
      }),

    submitResult: protectedProcedure
      .input(z.object({ gameId: z.number(), duelId: z.number(), proposedWinnerId: z.number(), evidenceUrl: z.string().optional(), witnessName: z.string().optional(), notes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        const duel = await db.getDuel(input.duelId);
        if (!player || !duel || duel.gameId !== input.gameId || duel.challengerId !== player.id || duel.status !== "awaiting_result") throw new Error("This duel is not ready for your result");
        if (![duel.challengerId, duel.opponentId].includes(input.proposedWinnerId)) throw new Error("Winner must be one of the duelists");
        if (!input.evidenceUrl?.trim() && !input.witnessName?.trim()) throw new Error("Attach video evidence or name a witness");
        await db.submitDuelResult(duel.id, input.proposedWinnerId, input.evidenceUrl, input.witnessName, input.notes);
        return { success: true };
      }),

    pending: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        return db.getPendingDuels(input.gameId);
      }),

    resolve: protectedProcedure
      .input(z.object({ gameId: z.number(), duelId: z.number(), approved: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const result = await db.resolveDuel(input.duelId, input.approved, ctx.user.id);
        const winner = await db.getPlayerById(result.winnerId);
        const loser = await db.getPlayerById(result.loserId);
        if (winner) {
          await db.createNotification({ userId: winner.userId, gameId: input.gameId, type: "power_up_used", title: result.approved ? "🎯 You Won the Duel!" : "Duel Result Rejected", body: result.approved ? `+350 points${result.stoleItem ? " and you received the loser's stake" : ""}.` : "The admin rejected the result and both stakes were unlocked." });
          await sendPushToUser(winner.userId, { title: result.approved ? "🎯 Duel Won" : "Duel Result Rejected", body: result.approved ? "You earned 350 points and the loser's stake." : "Both stakes were returned.", data: { type: "snipers_duel", gameId: input.gameId } });
        }
        if (loser) {
          await db.createNotification({ userId: loser.userId, gameId: input.gameId, type: "power_up_used", title: result.approved ? "You Lost the Duel" : "Duel Result Rejected", body: result.approved ? "Your staked power-up was awarded to the winner." : "Both stakes were returned." });
          await sendPushToUser(loser.userId, { title: result.approved ? "Duel Result" : "Duel Result Rejected", body: result.approved ? "The admin approved the submitted winner." : "Both stakes were returned.", data: { type: "snipers_duel", gameId: input.gameId } });
        }
        if (result.approved) await db.createKillFeedEvent({ gameId: input.gameId, eventType: "power_up_used", actorId: result.winnerId, targetId: result.loserId, message: "🎯 Sniper's Duel resolved: 350 points and the loser's stake awarded!" });
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
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const id = await db.createRule(input);
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), isEnabled: z.boolean().optional(), ruleText: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const rule = await db.getRule(id);
        if (!rule) throw new Error("Rule not found");
        const game = await db.getGame(rule.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        await db.updateRule(id, data);
        return { success: true };
      }),

    // One protected, transactional, idempotent bulk operation instead of
    // the client firing one createRule mutation per standard rule with a
    // forEach -- that could partially load the catalog on a failure
    // partway through, and refetched rules.list once per rule instead of
    // once overall.
    seedStandard: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const ruleTexts = STANDARD_RULES[game.gameType as StandardRulesGameType] ?? [];
        return db.seedStandardRules(input.gameId, ruleTexts);
      }),
  }),

  mapPowerUp: router({
    list: protectedProcedure
      .input(z.object({ gameId: z.number() }))
      .query(async ({ input, ctx }) => {
        const viewer = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!viewer) return [];
        const game = await db.getGame(input.gameId);
        const isAdmin = game?.adminId === ctx.user.id || ctx.user.isSuperAdmin;
        await db.expirePlayerPowerUps(input.gameId);
        const smokeScreens = await db.getActiveGamePowerUpsByName(input.gameId, "Smoke Screen");
        if (!isAdmin && smokeScreens.length && !smokeScreens.some(smoke => smoke.gamePlayerId === viewer.id)) return [];
        const placed = await db.getMapPowerUps(input.gameId);
        if (isAdmin) return placed.map(item => ({ ...item, discovered: true }));
        const discoveries = await db.getMapPowerUpDiscoveries(viewer.id);
        const discoveredIds = new Set(discoveries.map(discovery => discovery.mapPowerUpId));
        return placed.map(item => item.isVisible || discoveredIds.has(item.id)
          ? { ...item, discovered: item.isVisible || discoveredIds.has(item.id) }
          : { ...item, latitude: null, longitude: null, discovered: false });
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
      .mutation(async ({ input, ctx }) => {
        const game = await db.getGame(input.gameId);
        if (!game || (game.adminId !== ctx.user.id && !ctx.user.isSuperAdmin)) throw new Error("Admin access required");
        const id = await db.createMapPowerUp(input);
        return { id };
      }),

    claim: protectedProcedure
      .input(z.object({ mapPowerUpId: z.number(), gameId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const player = await db.getPlayerInGame(input.gameId, ctx.user.id);
        if (!player) throw new Error("Not in this game");
        await db.expirePlayerPowerUps(input.gameId);
        const smokeScreens = await db.getActiveGamePowerUpsByName(input.gameId, "Smoke Screen");
        if (smokeScreens.length && !smokeScreens.some(smoke => smoke.gamePlayerId === player.id)) throw new Error("Map pickups are hidden by Smoke Screen");
        const placed = await db.getMapPowerUps(input.gameId);
        const pickup = placed.find(item => item.id === input.mapPowerUpId);
        if (!pickup || pickup.claimedBy) throw new Error("This map power-up is no longer available");
        if (!player.latitude || !player.longitude) throw new Error("Enable location before collecting");
        if (!pickup.isVisible) {
          const discoveries = await db.getMapPowerUpDiscoveries(player.id);
          if (!discoveries.some(discovery => discovery.mapPowerUpId === pickup.id)) throw new Error("Find this hidden power-up before collecting it");
        }
        const distance = distanceMeters(Number(player.latitude), Number(player.longitude), Number(pickup.latitude), Number(pickup.longitude));
        if (distance > MAP_CLAIM_METERS) throw new Error(`Move within ${MAP_CLAIM_METERS} meters to collect this power-up`);
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
        const smokeScreens = await db.getActiveGamePowerUpsByName(input.gameId, "Smoke Screen");
        if (smokeScreens.length && !smokeScreens.some(smoke => smoke.gamePlayerId === player.id)) throw new Error("Map pickups are hidden by Smoke Screen");
        const mapPowerUps = await db.getMapPowerUps(input.gameId);
        // Only return proximity for unclaimed, hidden power-ups
        const hidden = mapPowerUps.filter(mp => !mp.isVisible && !mp.claimedBy);

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
          const dist = distanceMeters(
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
        await db.expirePlayerPowerUps(input.gameId);
        const smokeScreens = await db.getActiveGamePowerUpsByName(input.gameId, "Smoke Screen");
        if (smokeScreens.length && !smokeScreens.some(smoke => smoke.gamePlayerId === player.id)) throw new Error("Map pickups are hidden by Smoke Screen");
        const mapPowerUps = await db.getMapPowerUps(input.gameId);
        const target = mapPowerUps.find(mp => mp.id === input.mapPowerUpId);
        if (!target) throw new Error("Power-up not found");
        if (target.claimedBy) throw new Error("This power-up has already been claimed");

        const dist = distanceMeters(
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
          isCorrect: dist <= MAP_DISCOVERY_METERS,
        });

        if (dist <= MAP_DISCOVERY_METERS) {
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
        const outcomes = await db.getRouletteOutcomes(input.gameId);
        const enabled = outcomes.filter(o => o.isEnabled);
        if (enabled.length === 0) throw new Error("No roulette outcomes configured");
        if ((player.points || 0) - (player.reservedPoints || 0) < ROULETTE_SPIN_COST) {
          throw new Error("Not enough available points (50 points are required; Bodyguard reservations cannot be spent)");
        }
        const balanceAfterSpin = rouletteBalanceAfterOutcome(player.points || 0, "nothing");
        await db.updatePlayer(player.id, { points: balanceAfterSpin });
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
        let inventoryId: number | null = null;
        let prizePowerUp: { id: number; name: string; emoji: string } | null = null;
        switch (selected.type) {
          case "points_bonus":
            await db.updatePlayer(player.id, { points: rouletteBalanceAfterOutcome(player.points || 0, selected.type, selected.value || 0) });
            resultMessage = `Won ${selected.value} points!`;
            break;
          case "points_penalty":
            await db.updatePlayer(player.id, { points: rouletteBalanceAfterOutcome(player.points || 0, selected.type, selected.value || 0) });
            resultMessage = `Lost ${selected.value} points!`;
            break;
          case "power_up":
            {
              const catalog = await db.getGamePowerUps(input.gameId);
              const configuredPrize = selected.powerUpId
                ? catalog.find(powerUp => powerUp.id === selected.powerUpId && powerUp.isEnabled && powerUp.name !== "Roulette")
                : null;
              const eligiblePrizes = configuredPrize ? [configuredPrize] : catalog.filter(powerUp => powerUp.isEnabled && powerUp.name !== "Roulette");
              const eligibleWithCapacity: typeof eligiblePrizes = [];
              for (const powerUp of eligiblePrizes) {
                const usageCount = await db.getPlayerPowerUpUsageCount(player.id, powerUp.id, input.gameId);
                if (powerUp.maxUsesPerGame == null || usageCount < powerUp.maxUsesPerGame) eligibleWithCapacity.push(powerUp);
              }
              if (eligibleWithCapacity.length === 0) {
                await db.updatePlayer(player.id, { points: player.points || 0 });
                throw new Error("No eligible power-up prize is currently available. Your 50 points were refunded.");
              }
              const wonPowerUp = eligibleWithCapacity[Math.floor(Math.random() * eligibleWithCapacity.length)];
              inventoryId = await db.purchasePowerUp(player.id, wonPowerUp.id, input.gameId);
              prizePowerUp = { id: wonPowerUp.id, name: wonPowerUp.name, emoji: wonPowerUp.emoji };
              resultMessage = `Won ${wonPowerUp.emoji} ${wonPowerUp.name}! It has been added to your inventory.`;
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
        return { outcome: selected, message: resultMessage, spinCost: ROULETTE_SPIN_COST, inventoryId, prizePowerUp };
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
