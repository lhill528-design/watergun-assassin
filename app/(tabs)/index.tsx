import { ScrollView, Text, View, TouchableOpacity, Image } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { startOAuthLogin } from "@/constants/oauth";

function CountdownTimer({ endTime, label, color }: { endTime: string | null; label: string; color: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!endTime) { setTimeLeft("--:--:--"); return; }
    const interval = setInterval(() => {
      const diff = new Date(endTime).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("00:00:00"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [endTime]);

  return (
    <View className="items-center">
      <Text className="text-xs text-muted uppercase tracking-wider">{label}</Text>
      <Text style={{ color, fontSize: 28, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{timeLeft}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { user, isAuthenticated } = useAuth();
  const { activeGameId } = useGame();
  const router = useRouter();

  const gameQuery = trpc.game.get.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const playerQuery = trpc.player.me.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated, refetchInterval: 15_000 }
  );

  const game = gameQuery.data;
  const player = playerQuery.data;
  const targetProtection = player?.targetProtectionBadge;

  if (!isAuthenticated) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center gap-6">
          <Image source={require("@/assets/images/icon.png")} style={{ width: 120, height: 120, borderRadius: 20 }} />
          <Text className="text-3xl font-bold text-foreground text-center">WATERGUN{"\n"}ASSASSIN</Text>
          <Text className="text-base text-muted text-center">Silent. Soak. Survive.</Text>
          <TouchableOpacity
            className="bg-primary px-8 py-4 rounded-full mt-4"
            onPress={() => startOAuthLogin()}
          >
            <Text className="text-background font-bold text-lg">Sign In to Play</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  if (!activeGameId) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center gap-6">
          <Image source={require("@/assets/images/icon.png")} style={{ width: 100, height: 100, borderRadius: 16 }} />
          <Text className="text-2xl font-bold text-foreground text-center">No Active Game</Text>
          <Text className="text-base text-muted text-center">Join a game or create one from your profile.</Text>
          <TouchableOpacity
            className="bg-primary px-8 py-4 rounded-full"
            onPress={() => router.push("/join-game" as any)}
          >
            <Text className="text-background font-bold text-base">Join with Code</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="bg-surface px-8 py-4 rounded-full border border-border"
            onPress={() => router.push("/(tabs)/profile" as any)}
          >
            <Text className="text-foreground font-bold text-base">Go to Profile</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {/* Game Header */}
        <View className="items-center mb-4">
          <Text className="text-xs text-muted uppercase tracking-widest">{game?.gameType?.replace(/_/g, " ")}</Text>
          <Text className="text-2xl font-bold text-foreground">{game?.name || "Loading..."}</Text>
          {game?.status === "active" && (
            <View className="bg-success/20 px-3 py-1 rounded-full mt-1">
              <Text className="text-success text-xs font-bold">LIVE</Text>
            </View>
          )}
        </View>

        {/* Purge Banner */}
        {game?.purgeActive && (
          <View className="bg-error/20 border border-error rounded-xl p-4 mb-4">
            <Text className="text-error text-center font-bold text-lg">⚠️ PURGE ACTIVE ⚠️</Text>
            <Text className="text-error/80 text-center text-xs mt-1">All players can be eliminated. No safe objects.</Text>
            <View className="mt-2">
              <CountdownTimer endTime={game.purgeEndTime as any} label="Purge Ends In" color="#FF3333" />
            </View>
          </View>
        )}

        {/* Timers */}
        <View className="bg-surface rounded-xl p-4 mb-4">
          <View className="flex-row justify-around">
            <CountdownTimer endTime={game?.roundEndTime as any} label="Round Ends" color="#00D4FF" />
            <View className="items-center">
              <Text className="text-xs text-muted uppercase tracking-wider">Round</Text>
              <Text className="text-foreground text-2xl font-bold">{game?.currentRound || 0}</Text>
            </View>
          </View>
        </View>

        {/* Safe Object */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-xs text-muted uppercase tracking-wider mb-1">🛡️ Safe Object</Text>
          <Text className="text-foreground text-xl font-bold">{(game?.temporarySafeObjectExpiresAt && new Date(game.temporarySafeObjectExpiresAt).getTime() > Date.now() ? game.temporarySafeObject : null) || game?.safeObject || "Not Set"}</Text>
          <Text className="text-muted text-xs mt-1">Hold this to be immune from elimination</Text>
        </View>

        {/* Target Info */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-primary/30">
          <Text className="text-xs text-primary uppercase tracking-wider mb-1">🎯 Your Target</Text>
          {player?.targetId ? (
            <View>
              <View className="flex-row items-center gap-2 flex-wrap">
                <Text className="text-foreground text-xl font-bold">{player.targetName || `Player #${player.targetId}`}</Text>
                {targetProtection && (
                  <View className="bg-primary/20 border border-primary rounded-full px-2 py-1">
                    <Text className="text-primary text-xs font-bold">🛡️ {targetProtection.label}</Text>
                  </View>
                )}
              </View>
              {targetProtection && (
                <View className={`rounded-lg p-3 mt-2 border ${targetProtection.paused ? "bg-warning/10 border-warning" : "bg-primary/10 border-primary"}`}>
                  <Text className={targetProtection.paused ? "text-warning text-xs font-bold" : "text-primary text-xs font-bold"}>
                    {targetProtection.paused
                      ? "Protection is paused during the current Purge."
                      : `PROTECTED — ${targetProtection.label} is currently active. Do not submit an elimination.`}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                className="bg-primary/20 px-4 py-2 rounded-lg mt-2 self-start"
                onPress={() => router.push("/(tabs)/map" as any)}
              >
                <Text className="text-primary font-semibold text-sm">View on Map →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text className="text-muted text-base">No target assigned yet</Text>
          )}
        </View>

        {/* Player Status */}
        <View className="bg-surface rounded-xl p-4 mb-4">
          <View className="flex-row justify-between items-center">
            <View>
              <Text className="text-xs text-muted uppercase">Status</Text>
              <Text className={`text-lg font-bold ${player?.status === "alive" ? "text-success" : player?.status === "safe" ? "text-warning" : "text-error"}`}>
                {(player?.status || "unknown").toUpperCase()}
              </Text>
            </View>
            <View className="items-center">
              <Text className="text-xs text-muted uppercase">Points</Text>
              <Text className="text-foreground text-lg font-bold">{player?.points || 0}</Text>
            </View>
            <View className="items-end">
              <Text className="text-xs text-muted uppercase">Kills</Text>
              <Text className="text-foreground text-lg font-bold">{player?.kills || 0}</Text>
            </View>
          </View>
        </View>

        {/* Partner (if teams) */}
        {game?.gameType === "teams" && player?.partnerId && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-xs text-muted uppercase tracking-wider mb-1">👥 Partner</Text>
            <Text className="text-foreground text-lg font-bold">Partner #{player.partnerId}</Text>
          </View>
        )}

        {/* Quick Actions Row 1 */}
        <View className="flex-row gap-3 mb-3">
          <TouchableOpacity
            className="flex-1 bg-error/20 border border-error rounded-xl p-4 items-center"
            onPress={() => router.push("/elimination-upload" as any)}
          >
            <Text className="text-2xl mb-1">🎬</Text>
            <Text className="text-error font-bold text-sm">Upload Kill</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-primary/20 border border-primary rounded-xl p-4 items-center"
            onPress={() => router.push("/kill-feed" as any)}
          >
            <Text className="text-2xl mb-1">💀</Text>
            <Text className="text-primary font-bold text-sm">Kill Feed</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Actions Row 2 */}
        <View className="flex-row gap-3 mb-3">
          <TouchableOpacity
            className="flex-1 bg-warning/20 border border-warning rounded-xl p-4 items-center"
            onPress={() => router.push("/bounty-board" as any)}
          >
            <Text className="text-2xl mb-1">🎯</Text>
            <Text className="text-warning font-bold text-sm">Bounties</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 bg-success/20 border border-success rounded-xl p-4 items-center"
            onPress={() => router.push("/leaderboard" as any)}
          >
            <Text className="text-2xl mb-1">🏆</Text>
            <Text className="text-success font-bold text-sm">Leaderboard</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity className="bg-surface rounded-xl p-4 mb-4 border border-warning flex-row items-center justify-between" onPress={() => router.push("/duels" as any)}><View className="flex-row items-center gap-3"><Text className="text-2xl">🎯</Text><Text className="text-foreground font-bold">Sniper's Duels</Text></View><Text className="text-warning">View / Respond →</Text></TouchableOpacity>

        {/* Notifications */}
        <TouchableOpacity
          className="bg-surface rounded-xl p-4 mb-4 border border-border flex-row items-center justify-between"
          onPress={() => router.push("/notifications" as any)}
        >
          <View className="flex-row items-center gap-3">
            <Text className="text-2xl">🔔</Text>
            <Text className="text-foreground font-bold">Notifications</Text>
          </View>
          <Text className="text-primary font-bold">→</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenContainer>
  );
}
