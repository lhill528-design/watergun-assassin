import { Text, View, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useAuth } from "@/hooks/use-auth";
import { useGame } from "@/lib/game-context";
import { trpc } from "@/lib/trpc";
import { useState } from "react";

export default function ProfileScreen() {
  const { user, isAuthenticated, logout } = useAuth();
  const { activeGameId, setActiveGameId, demoMode } = useGame();
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  const playerQuery = trpc.player.me.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const myGamesQuery = trpc.game.myGames.useQuery(undefined, { enabled: isAuthenticated });
  const activePowerUpsQuery = trpc.powerUp.playerActive.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );
  const achievementsQuery = trpc.achievement.playerList.useQuery(
    { gameId: activeGameId! },
    { enabled: !!activeGameId && isAuthenticated }
  );

  const player = playerQuery.data;
  const myGames = myGamesQuery.data || [];
  const activePowerUps = activePowerUpsQuery.data || [];
  const achievements = achievementsQuery.data || [];

  if (!isAuthenticated && !demoMode) {
    return (
      <ScreenContainer className="p-6">
        <View className="flex-1 items-center justify-center gap-4">
          <Text className="text-4xl">👤</Text>
          <Text className="text-foreground text-xl font-bold">Sign In Required</Text>
          <TouchableOpacity
            className="bg-primary px-8 py-3 rounded-full"
            onPress={() => router.push("/oauth/callback" as any)}
          >
            <Text className="text-background font-bold">Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* User Header */}
        <View className="items-center mb-6">
          <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-3">
            <Text className="text-3xl">🎯</Text>
          </View>
          <Text className="text-xl font-bold text-foreground">{user?.name || "Player"}</Text>
          <Text className="text-muted text-sm">{user?.email}</Text>
          {user?.role === "admin" && (
            <View className="bg-primary/20 px-3 py-1 rounded-full mt-2">
              <Text className="text-primary text-xs font-bold">ADMIN</Text>
            </View>
          )}
        </View>

        {/* Current Game Stats */}
        {player && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">📊 Current Game Stats</Text>
            <View className="flex-row justify-between">
              <View className="items-center">
                <Text className="text-2xl font-bold text-foreground">{player.kills || 0}</Text>
                <Text className="text-xs text-muted">Kills</Text>
              </View>
              <View className="items-center">
                <Text className="text-2xl font-bold text-foreground">{player.deaths || 0}</Text>
                <Text className="text-xs text-muted">Deaths</Text>
              </View>
              <View className="items-center">
                <Text className="text-2xl font-bold text-primary">{player.points || 0}</Text>
                <Text className="text-xs text-muted">Points</Text>
              </View>
              <View className="items-center">
                <Text className={`text-2xl font-bold ${player.status === "alive" ? "text-success" : "text-error"}`}>
                  {player.status === "alive" ? "🟢" : "💀"}
                </Text>
                <Text className="text-xs text-muted">Status</Text>
              </View>
            </View>
          </View>
        )}

        {/* Active Power-Ups */}
        {activePowerUps.length > 0 && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">⚡ Active Power-Ups</Text>
            {activePowerUps.map((pp) => (
              <View key={pp.id} className="flex-row items-center justify-between py-2 border-b border-border">
                <Text className="text-foreground text-sm">Power-Up #{pp.powerUpId}</Text>
                <Text className="text-muted text-xs">
                  {pp.expiresAt ? `Expires: ${new Date(pp.expiresAt).toLocaleTimeString()}` : "Permanent"}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
            <Text className="text-sm font-bold text-foreground mb-3">🏅 Achievements ({achievements.length})</Text>
            <View className="flex-row flex-wrap gap-2">
              {achievements.map((a) => (
                <View key={a.id} className="bg-primary/10 px-3 py-1 rounded-full">
                  <Text className="text-primary text-xs font-semibold">Badge #{a.achievementId}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* My Games */}
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text className="text-sm font-bold text-foreground mb-3">🎮 My Games</Text>
          {myGames.length === 0 ? (
            <Text className="text-muted text-sm">No games yet. Create or join one!</Text>
          ) : (
            myGames.map((g) => (
              <TouchableOpacity
                key={g.id}
                className={`flex-row items-center justify-between py-3 border-b border-border ${activeGameId === g.id ? "opacity-100" : "opacity-70"}`}
                onPress={() => setActiveGameId(g.id)}
              >
                <View>
                  <Text className="text-foreground font-semibold">{g.name}</Text>
                  <Text className="text-muted text-xs">{g.gameType.replace(/_/g, " ")} • {g.status}</Text>
                </View>
                {activeGameId === g.id && (
                  <View className="bg-success/20 px-2 py-1 rounded">
                    <Text className="text-success text-xs font-bold">ACTIVE</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Admin Panel Access */}
        {(user?.role === "admin" || user?.isSuperAdmin || demoMode) && (
          <TouchableOpacity
            className="bg-primary rounded-xl p-4 mb-4 items-center"
            onPress={() => router.push("/admin" as any)}
          >
            <Text className="text-background font-bold text-base">👑 Admin Panel</Text>
            <Text className="text-background/70 text-xs mt-1">Manage games, players, and settings</Text>
          </TouchableOpacity>
        )}

        {/* Actions */}
        <View className="gap-3">
          <TouchableOpacity
            className="bg-surface border border-primary rounded-xl p-4 items-center"
            onPress={() => router.push("/admin/create-game" as any)}
          >
            <Text className="text-primary font-bold">+ Create New Game</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-surface border border-border rounded-xl p-4 items-center"
            onPress={() => router.push("/kill-feed" as any)}
          >
            <Text className="text-foreground font-bold">💀 Kill Feed</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-surface border border-border rounded-xl p-4 items-center"
            onPress={() => router.push("/game-history" as any)}
          >
            <Text className="text-foreground font-bold">🏁 Game History</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-surface border border-error rounded-xl p-4 items-center"
            onPress={() => {
              Alert.alert("Logout", "Are you sure?", [
                { text: "Cancel", style: "cancel" },
                { text: "Logout", style: "destructive", onPress: logout },
              ]);
            }}
          >
            <Text className="text-error font-bold">Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
